import { describe, expect, it } from "vitest";
import documents from "../../sample-data/documents-2026.json";
import type { TicketReadResult } from "../extract/read-ticket";
import { ticketReadSchema, type TicketRead } from "../extract/ticket-schema";
import { sha256Hex, type CaptureInfo } from "../photos/photo-file";
import type { SeenKind } from "../rules/document-kind";
import type { TicketCheck } from "../rules/ticket-checks";
import type { SavedTicketIdentity } from "../rules/ticket-matching";
import {
  addTicket,
  tripStartedAt,
  type AddTicketDeps,
  type FarmRecords,
  type NewTicket,
  type NewTrip,
  type TicketStore,
} from "./add-ticket";

// The sample tickets' printed values stand in for what Claude reads.
const answer = (name: "ticket-1" | "ticket-2"): TicketRead => ticketReadSchema.parse(documents.documents[name].values);
const TICKET_1 = answer("ticket-1");
const TICKET_2 = answer("ticket-2");

const jpeg = (...rest: number[]) => new Uint8Array([0xff, 0xd8, 0xff, ...rest]);
const PHOTO = jpeg(1);
const NOW = new Date("2026-10-12T16:05:00Z");
const CAPTURE: CaptureInfo = {
  capturedAt: "2026-10-12T10:50:00-05:00",
  location: { longitude: -93.451, latitude: 42.023 },
};

const FARM: FarmRecords = {
  fields: [
    { id: "north-80", name: "North 80" },
    { id: "south-40", name: "South 40" },
  ],
  fieldSeasons: [
    { field_id: "north-80", crop_year: 2026, crop: "corn", planting_completed_date: "2026-05-02" },
    { field_id: "south-40", crop_year: 2026, crop: "corn", planting_completed_date: "2026-05-02" },
  ],
  trucks: [
    { id: "truck-1", name: "Truck 1", capacity_bu: 1000 },
    { id: "truck-2", name: "Truck 2", capacity_bu: 900 },
  ],
  buyers: [{ id: "elevator", name: "Main Street Elevator" }],
};

/** A database made of arrays, with the rules the real one enforces that matter here. */
function fakeStore(farm: FarmRecords = FARM) {
  const photos = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const trips: (NewTrip & { id: string })[] = [];
  const tickets: (NewTicket & { id: string; uploaded_at: string })[] = [];
  let failNextTicket: Error | null = null;

  const store: TicketStore = {
    async findTicketByHash(hash) {
      return tickets.find((t) => t.photo_sha256 === hash) ?? null;
    },
    async loadFarmRecords() {
      return farm;
    },
    async findTicketsByNumberAndDate(number, date) {
      return tickets.filter((t) => t.ticket_number === number && t.ticket_date === date) as unknown as SavedTicketIdentity[];
    },
    async savePhoto(path, bytes, type) {
      photos.set(path, { bytes, mediaType: type.mediaType });
    },
    async insertTrip(trip) {
      const row = { ...trip, id: `trip-${trips.length + 1}` };
      trips.push(row);
      return { id: row.id };
    },
    async deleteTrip(id) {
      trips.splice(trips.findIndex((t) => t.id === id), 1);
    },
    async insertTicket(ticket) {
      if (failNextTicket) throw failNextTicket;
      if (tickets.some((t) => t.photo_sha256 === ticket.photo_sha256)) throw new Error("duplicate photo_sha256");
      const row = { ...ticket, id: `ticket-${tickets.length + 1}`, uploaded_at: `2026-10-12T16:0${tickets.length}:00Z` };
      tickets.push(row);
      return { id: row.id };
    },
  };
  return {
    store,
    photos,
    trips,
    tickets,
    failTicketInserts: (error: Error) => {
      failNextTicket = error;
    },
  };
}

function reads(values: TicketRead | null) {
  let calls = 0;
  const read = async (): Promise<TicketReadResult> => {
    calls += 1;
    const base = { model: "sonnet" as const, effort: "medium" as const, seconds: 3.6, usage: { input_tokens: 8300, output_tokens: 450 } };
    return values ? { ...base, ok: true, values } : { ...base, ok: false, reason: "The model returned no values." };
  };
  return { read, calls: () => calls };
}

/** A reader that says the photo isn't a scale ticket, and what it is. */
function readsWrongKind(wrongKind: SeenKind) {
  let calls = 0;
  const read = async (): Promise<TicketReadResult> => {
    calls += 1;
    return {
      model: "sonnet",
      effort: "medium",
      seconds: 2.1,
      usage: { input_tokens: 8300, output_tokens: 60 },
      ok: false,
      reason: `The file is ${wrongKind}, not a scale ticket.`,
      wrongKind,
    };
  };
  return { read, calls: () => calls };
}

function deps(db: ReturnType<typeof fakeStore>, reader: { read: AddTicketDeps["read"] }): AddTicketDeps {
  return { store: db.store, read: reader.read, captureInfo: async () => CAPTURE, now: () => NOW };
}

describe("addTicket: one sample ticket, start to finish", () => {
  it("stores the photo, the trip and the ticket", async () => {
    const db = fakeStore();
    const outcome = await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));

    expect(outcome).toEqual({ status: "saved", ticketId: "ticket-1" });
    expect([...db.photos.keys()]).toEqual([`tickets/${sha256Hex(PHOTO)}.jpg`]);
    expect(db.photos.get(`tickets/${sha256Hex(PHOTO)}.jpg`)).toEqual({ bytes: PHOTO, mediaType: "image/jpeg" });
    expect(db.trips).toHaveLength(1);
    expect(db.tickets).toHaveLength(1);
  });

  it("builds the real chain: the trip runs from North 80 to the elevator and the ticket points to it", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));

    expect(db.trips[0]).toEqual({
      id: "trip-1",
      truck_id: "truck-1",
      origin_field_id: "north-80",
      dest_buyer_id: "elevator",
      crop_year: 2026,
      started_at: "2026-10-12 10:42 America/Chicago",
      estimated_bu: 1000,
      moisture_pct: 17.5,
      status: "closed",
      trust: "manual",
    });
    expect(db.tickets[0].trip_id).toBe("trip-1");
    expect(db.tickets[0].duplicate_of).toBeNull();
  });

  it("keeps the original file's hash, capture time and GPS, and who added it", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));

    expect(db.tickets[0]).toMatchObject({
      photo_path: `tickets/${sha256Hex(PHOTO)}.jpg`,
      photo_sha256: sha256Hex(PHOTO),
      captured_at: "2026-10-12T10:50:00-05:00",
      capture_location: "SRID=4326;POINT(-93.451 42.023)",
      source: "upload",
      uploaded_by: "farmer",
      trust: "manual",
    });
  });

  it("saves the read values in their columns, with the time in", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));

    expect(db.tickets[0]).toMatchObject({
      buyer_name: "Main Street Elevator",
      ticket_number: "20871",
      ticket_date: "2026-10-12",
      ticket_time: "10:42",
      crop: "corn",
      gross_lbs: 80120,
      tare_lbs: 24600,
      net_lbs: 55520,
      moisture_pct: 17.5,
      truck_number: "1",
      base_moisture_pct: 15,
      shrink_pct_per_point: 1.4,
      contract_number: "SAMPLE-C-2611",
      read_model: "claude-sonnet-5-5",
      read_at: "2026-10-12T16:05:00.000Z",
    });
  });

  it("saves the other printed values in their own column, not in read_confidence", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));
    const ticket = db.tickets[0];

    expect(ticket.other_printed_values).toEqual({
      buyer_address: "SAMPLE: Main Street, Nevada, IA",
      direction: "in",
      purchase_type: "contract",
      customer: "Dave's Farm (SAMPLE)",
      grain: "Yellow Corn",
      driver_on: true,
      wet_bu: 991.43,
      shrink_pct: 3.5,
      elevator_dry_bu: 956.73,
      weigher: "KL",
    });
    // The ticket's own bushels never land in the columns that hold ours.
    expect(ticket).not.toHaveProperty("weigher");
    expect(ticket).not.toHaveProperty("shrink_pct");
    expect(Object.keys(ticket.read_confidence as object)).toEqual(["checks"]);
  });

  it("saves the check results and the bushels calculated from the raw values", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));
    const ticket = db.tickets[0];

    const checks = (ticket.read_confidence as { checks: TicketCheck[] }).checks;
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["net_weight", "pass"],
      ["wet_bushels", "pass"],
      ["harvest_date", "pass"],
      ["shrink", "pass"],
      ["dry_bushels", "pass"],
    ]);
    expect(ticket.wet_bu).toBeCloseTo(991.43, 2);
    expect(ticket.elevator_dry_bu).toBeCloseTo(956.73, 2);
    expect(ticket.production_to_count_bu).toBeCloseTo(961.69, 2);
    expect(ticket.calc_version).toBe("1");
  });

  it("uses the truck printed on the ticket, and its capacity as the estimate", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_2)));
    expect(db.trips[0]).toMatchObject({ truck_id: "truck-2", estimated_bu: 900 });
  });

  it("stores a PNG with its real extension", async () => {
    const db = fakeStore();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await addTicket(png, "farmer", deps(db, reads(TICKET_1)));

    expect([...db.photos.keys()]).toEqual([`tickets/${sha256Hex(png)}.png`]);
    expect(db.photos.get(`tickets/${sha256Hex(png)}.png`)?.mediaType).toBe("image/png");
    expect(db.tickets[0].photo_path).toBe(`tickets/${sha256Hex(png)}.png`);
  });
});

describe("addTicket: a failed check", () => {
  it("still saves and links the ticket, with the failed check recorded", async () => {
    const db = fakeStore();
    // The net weight misread by one digit.
    const outcome = await addTicket(PHOTO, "farmer", deps(db, reads({ ...TICKET_1, net_lbs: 55_920 })));

    expect(outcome.status).toBe("saved");
    const checks = (db.tickets[0].read_confidence as { checks: TicketCheck[] }).checks;
    expect(checks.find((c) => c.id === "net_weight")).toMatchObject({
      status: "fail",
      message: "Net weight reads 55,920 lb, but gross − tare is 55,520 lb.",
    });
    // Bushels come from gross − tare, so the misread net doesn't move them.
    expect(db.tickets[0].wet_bu).toBeCloseTo(991.43, 2);
    expect(db.tickets[0].net_lbs).toBe(55_920);
  });
});

describe("addTicket: the same ticket twice", () => {
  it("adds nothing when the very same file is chosen again, and doesn't pay for a read", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));
    const again = reads(TICKET_1);
    const outcome = await addTicket(PHOTO, "farmer", deps(db, again));

    expect(outcome).toEqual({ status: "already_added", ticketId: "ticket-1" });
    expect(again.calls()).toBe(0);
    expect(db.trips).toHaveLength(1);
    expect(db.tickets).toHaveLength(1);
  });

  it("keeps a second photo of the same ticket, but gives it no trip so it isn't counted twice", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));
    const secondPhoto = jpeg(2);
    const outcome = await addTicket(secondPhoto, "farmer", deps(db, reads(TICKET_1)));

    expect(outcome).toEqual({ status: "duplicate", ticketId: "ticket-2", originalTicketId: "ticket-1" });
    expect(db.trips).toHaveLength(1);
    expect(db.tickets[1]).toMatchObject({
      trip_id: null,
      duplicate_of: "ticket-1",
      photo_sha256: sha256Hex(secondPhoto),
      ticket_number: "20871",
    });
    expect(db.photos.has(`tickets/${sha256Hex(secondPhoto)}.jpg`)).toBe(true);
  });

  it("points a third photo at the first ticket", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));
    await addTicket(jpeg(2), "farmer", deps(db, reads(TICKET_1)));
    const outcome = await addTicket(jpeg(3), "farmer", deps(db, reads(TICKET_1)));

    expect(outcome).toMatchObject({ status: "duplicate", originalTicketId: "ticket-1" });
    expect(db.trips).toHaveLength(1);
  });

  it("treats a different ticket number as a different load", async () => {
    const db = fakeStore();
    await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)));
    const outcome = await addTicket(jpeg(2), "farmer", deps(db, reads(TICKET_2)));

    expect(outcome.status).toBe("saved");
    expect(db.trips).toHaveLength(2);
  });
});

describe("addTicket: nothing is saved when", () => {
  async function expectNothingSaved(photo: Uint8Array, values: TicketRead | null, farm: FarmRecords = FARM) {
    const db = fakeStore(farm);
    const reader = reads(values);
    const outcome = await addTicket(photo, "farmer", deps(db, reader));
    expect(outcome.status).toBe("not_saved");
    expect(db.photos.size).toBe(0);
    expect(db.trips).toEqual([]);
    expect(db.tickets).toEqual([]);
    return { outcome: outcome as Extract<typeof outcome, { status: "not_saved" }>, reader };
  }

  it("the file isn't a JPEG or PNG, and no read is paid for", async () => {
    const { outcome, reader } = await expectNothingSaved(new TextEncoder().encode("%PDF-1.7"), TICKET_1);
    expect(outcome.message).toBe("That file isn't a JPEG or PNG photo. Choose a photo of the ticket.");
    expect(reader.calls()).toBe(0);
  });

  it("the read fails", async () => {
    const { outcome } = await expectNothingSaved(PHOTO, null);
    expect(outcome.message).toBe("The ticket couldn't be read, so nothing was saved. Try again, or use a clearer photo.");
    expect(outcome.detail).toBe("The model returned no values.");
  });

  it("the truck on the ticket isn't one of the farm's", async () => {
    const { outcome } = await expectNothingSaved(PHOTO, { ...TICKET_1, truck_number: "22" });
    expect(outcome.message).toBe('The ticket says truck "22", which isn\'t one of your trucks, so it can\'t be saved yet.');
  });

  it("the truck number wasn't read", async () => {
    const { outcome } = await expectNothingSaved(PHOTO, { ...TICKET_1, truck_number: null });
    expect(outcome.message).toBe("The truck number couldn't be read from the ticket, so it can't be saved yet.");
  });

  it("the buyer isn't one of the farm's", async () => {
    const { outcome } = await expectNothingSaved(PHOTO, { ...TICKET_1, buyer_name: "Prairie Ethanol" });
    expect(outcome.message).toBe('The ticket is from "Prairie Ethanol", which isn\'t one of your buyers, so it can\'t be saved yet.');
  });

  it("North 80 isn't on the farm map", async () => {
    const { outcome } = await expectNothingSaved(PHOTO, TICKET_1, { ...FARM, fields: [FARM.fields[1]] });
    expect(outcome.message).toBe(
      "North 80 isn't on the farm map yet, so this ticket can't be linked to a field. Nothing was saved.",
    );
  });

  it("North 80 has no season", async () => {
    const { outcome } = await expectNothingSaved(PHOTO, TICKET_1, { ...FARM, fieldSeasons: [FARM.fieldSeasons[1]] });
    expect(outcome.message).toBe(
      "North 80 has no season set up yet, so this ticket can't be linked to a unit. Nothing was saved.",
    );
  });
});

describe("addTicket: a photo that isn't a scale ticket", () => {
  const SETTLEMENT_PHOTO = jpeg(8);

  it.each([
    ["settlement", "This looks like a settlement, not a scale ticket. Choose a photo of the ticket."],
    ["fsa_map", "This looks like an FSA map, not a scale ticket. Choose a photo of the ticket."],
    ["fsa_578", "This looks like an FSA-578, not a scale ticket. Choose a photo of the ticket."],
    ["summary_of_coverage", "This looks like a Summary of Coverage, not a scale ticket. Choose a photo of the ticket."],
    ["other", "This doesn't look like a scale ticket. Choose a photo of the ticket."],
  ] as const)("is refused by name when it is named as %s, and nothing is saved", async (kind, sentence) => {
    const db = fakeStore();
    const outcome = await addTicket(SETTLEMENT_PHOTO, "farmer", deps(db, readsWrongKind(kind)));
    expect(outcome).toEqual({ status: "not_saved", message: sentence, detail: `The file is ${kind}, not a scale ticket.` });
    expect(db.photos.size).toBe(0);
    expect(db.trips).toEqual([]);
    expect(db.tickets).toEqual([]);
  });

  it("isn't remembered: a second try with the ticket works, and the refused photo can be tried again", async () => {
    const db = fakeStore();
    await addTicket(SETTLEMENT_PHOTO, "farmer", deps(db, readsWrongKind("settlement")));
    expect(await db.store.findTicketByHash(sha256Hex(SETTLEMENT_PHOTO))).toBeNull();

    expect(await addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)))).toEqual({ status: "saved", ticketId: "ticket-1" });
    expect(db.tickets.map((ticket) => ticket.photo_sha256)).toEqual([sha256Hex(PHOTO)]);

    // Chosen again, the refused photo is read again, not answered from memory.
    const again = readsWrongKind("settlement");
    expect(await addTicket(SETTLEMENT_PHOTO, "farmer", deps(db, again))).toMatchObject({ status: "not_saved" });
    expect(again.calls()).toBe(1);
  });
});

describe("addTicket: when the ticket can't be saved after its trip was", () => {
  it("removes the trip and passes the error on, so a retry starts clean", async () => {
    const db = fakeStore();
    db.failTicketInserts(new Error("database is down"));

    await expect(addTicket(PHOTO, "farmer", deps(db, reads(TICKET_1)))).rejects.toThrow("database is down");
    expect(db.trips).toEqual([]);
    expect(db.tickets).toEqual([]);
    // The photo stays. It is named by its hash, so the retry stores the same file again.
    expect(db.photos.size).toBe(1);
  });
});

describe("tripStartedAt", () => {
  it("is the ticket's printed date and time in, on the farm's clock", () => {
    expect(tripStartedAt("2026-10-12", "10:42")).toBe("2026-10-12 10:42 America/Chicago");
  });

  it("is noon when the ticket has no time, and left to the database when it has no date", () => {
    expect(tripStartedAt("2026-10-12", null)).toBe("2026-10-12 12:00 America/Chicago");
    expect(tripStartedAt(null, "10:42")).toBeUndefined();
  });
});
