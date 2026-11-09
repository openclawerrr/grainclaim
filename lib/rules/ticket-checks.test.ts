import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import {
  checkTicket,
  CHECKED_FIELDS,
  fieldsInFailedChecks,
  TICKET_CHECK_IDS,
  type HarvestWindow,
  type TicketCheckId,
  type TicketCheckInput,
} from "./ticket-checks";

const HARVEST: HarvestWindow = { after: "2026-05-02", through: "2026-12-31" };

// SAMPLE ticket 3, the handwritten one, as printed in the answer key.
const TICKET_3: TicketCheckInput = {
  ticket_date: "2026-10-12",
  crop: "corn",
  gross_lbs: 79_740,
  tare_lbs: 24_580,
  net_lbs: 55_160,
  wet_bu: 985,
  moisture_pct: 17.9,
  base_moisture_pct: 15,
  shrink_pct_per_point: 1.4,
  shrink_pct: 4.06,
  elevator_dry_bu: 945.01,
};

const statuses = (ticket: TicketCheckInput, harvest = HARVEST) =>
  Object.fromEntries(checkTicket(ticket, harvest).map((c) => [c.id, c.status])) as Record<TicketCheckId, string>;
const failed = (ticket: TicketCheckInput) =>
  checkTicket(ticket, HARVEST)
    .filter((c) => c.status === "fail")
    .map((c) => c.id);
const messageOf = (ticket: TicketCheckInput, id: TicketCheckId) =>
  checkTicket(ticket, HARVEST).find((c) => c.id === id)!.message;

describe("the sample tickets", () => {
  const tickets = documentsOfKind(loadDocumentsFile(), "scale_ticket");

  it("there are six", () => {
    expect(tickets).toHaveLength(6);
  });

  it.each(tickets)("%s passes every check as printed", (_name, doc) => {
    const checks = checkTicket(doc.values, HARVEST);
    expect(checks.map((c) => c.id)).toEqual([...TICKET_CHECK_IDS]);
    expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
  });
});

describe("one misread value fails the checks that use it", () => {
  it("ticket 3's gross read as 77,740 (its 9 looks like a 7) fails gross − tare = net", () => {
    const misread = { ...TICKET_3, gross_lbs: 77_740 };
    expect(failed(misread)).toEqual(["net_weight"]);
    expect(messageOf(misread, "net_weight")).toBe(
      "Net weight reads 55,160 lb, but gross − tare is 53,160 lb.",
    );
    expect([...fieldsInFailedChecks(checkTicket(misread, HARVEST))]).toEqual(["gross_lbs", "tare_lbs", "net_lbs"]);
  });

  it("a misread tare fails gross − tare = net", () => {
    expect(failed({ ...TICKET_3, tare_lbs: 24_530 })).toEqual(["net_weight"]);
  });

  it("a tare above gross fails with its own sentence", () => {
    const misread = { ...TICKET_3, tare_lbs: 84_580 };
    expect(failed(misread)).toEqual(["net_weight"]);
    expect(messageOf(misread, "net_weight")).toBe(
      "Tare reads 84,580 lb, more than the gross weight of 79,740 lb.",
    );
  });

  it("a misread net fails both the weight and the bushel check, but not dry bushels", () => {
    expect(failed({ ...TICKET_3, net_lbs: 55_100 })).toEqual(["net_weight", "wet_bushels"]);
  });

  it("misread bushels fail net ÷ standard weight only", () => {
    const misread = { ...TICKET_3, wet_bu: 935 };
    expect(failed(misread)).toEqual(["wet_bushels"]);
    expect(messageOf(misread, "wet_bushels")).toBe("Bushels read 935, but net ÷ 56 lb is 985.");
  });

  it("a misread moisture fails the shrink check", () => {
    const misread = { ...TICKET_3, moisture_pct: 17.4 };
    expect(failed(misread)).toEqual(["shrink"]);
    expect(messageOf(misread, "shrink")).toBe(
      "Shrink reads 4.06%, but 17.4% moisture at the buyer's rate gives 3.36%.",
    );
  });

  it("a misread shrink fails the shrink and dry bushel checks", () => {
    expect(failed({ ...TICKET_3, shrink_pct: 4.66 })).toEqual(["shrink", "dry_bushels"]);
  });

  it("misread dry bushels fail the dry bushel check, even by one hundredth", () => {
    const misread = { ...TICKET_3, elevator_dry_bu: 945.07 };
    expect(failed(misread)).toEqual(["dry_bushels"]);
    expect(messageOf(misread, "dry_bushels")).toBe(
      "Dry bushels read 945.07, but 985 bushels less 4.06% shrink is 945.01.",
    );
    expect(failed({ ...TICKET_3, elevator_dry_bu: 945.02 })).toEqual(["dry_bushels"]);
  });

  it("the wrong crop fails the bushel check (soybeans are 60 lb)", () => {
    expect(failed({ ...TICKET_3, crop: "soybeans" })).toEqual(["wet_bushels"]);
  });
});

describe("dry bushels", () => {
  it("pass from the printed bushels or from net ÷ standard weight unrounded", () => {
    // SAMPLE ticket 6: 55,340 lb ÷ 56 = 988.2143 bu, printed as 988.21, at 1.96% shrink.
    const ticket6: TicketCheckInput = {
      ...TICKET_3,
      gross_lbs: 79_960,
      tare_lbs: 24_620,
      net_lbs: 55_340,
      wet_bu: 988.21,
      moisture_pct: 16.4,
      shrink_pct: 1.96,
      elevator_dry_bu: 968.85, // from unrounded bushels
    };
    expect(failed(ticket6)).toEqual([]);
    expect(failed({ ...ticket6, elevator_dry_bu: 968.84 })).toEqual([]); // from 988.21
    expect(failed({ ...ticket6, elevator_dry_bu: 968.86 })).toEqual(["dry_bushels"]);
  });

  it("no shrink at or below the base moisture", () => {
    const dry = { ...TICKET_3, moisture_pct: 14.2, shrink_pct: 0, elevator_dry_bu: 985 };
    expect(failed(dry)).toEqual([]);
  });
});

describe("the harvest date", () => {
  it("fails on or before the day planting finished", () => {
    expect(statuses({ ...TICKET_3, ticket_date: "2026-05-02" }).harvest_date).toBe("fail");
    expect(statuses({ ...TICKET_3, ticket_date: "2026-05-03" }).harvest_date).toBe("pass");
  });

  it("fails in another year, such as a 2026 read as 2028", () => {
    const misread = { ...TICKET_3, ticket_date: "2028-10-12" };
    expect(statuses(misread).harvest_date).toBe("fail");
    expect(messageOf(misread, "harvest_date")).toBe(
      "The date reads 2028-10-12, outside this year's harvest (after 2026-05-02, through 2026-12-31).",
    );
  });

  it("passes on the last day and fails the day after", () => {
    expect(statuses({ ...TICKET_3, ticket_date: "2026-12-31" }).harvest_date).toBe("pass");
    expect(statuses({ ...TICKET_3, ticket_date: "2027-01-01" }).harvest_date).toBe("fail");
  });

  it("fails on something that isn't a date", () => {
    expect(statuses({ ...TICKET_3, ticket_date: "10/12/2026" }).harvest_date).toBe("fail");
    expect(statuses({ ...TICKET_3, ticket_date: "2026-13-40" }).harvest_date).toBe("fail");
  });
});

describe("values that weren't read", () => {
  it("a check missing a value is not checked, never passed", () => {
    const noTare = { ...TICKET_3, tare_lbs: null };
    expect(statuses(noTare)).toEqual({
      net_weight: "not_checked",
      wet_bushels: "pass",
      harvest_date: "pass",
      shrink: "pass",
      dry_bushels: "pass",
    });
    expect(messageOf(noTare, "net_weight")).toBe("Net weight can't be checked because tare weight wasn't read.");
  });

  it("names every missing value in one sentence", () => {
    const blank = { ...TICKET_3, moisture_pct: null, shrink_pct: null };
    expect(messageOf(blank, "shrink")).toBe("Shrink can't be checked because moisture and shrink weren't read.");
    expect(messageOf({ ...TICKET_3, ticket_date: null }, "harvest_date")).toBe(
      "The date can't be checked because the date wasn't read.",
    );
  });

  it("an unknown crop or a negative weight counts as not read", () => {
    expect(statuses({ ...TICKET_3, crop: "milo" }).wet_bushels).toBe("not_checked");
    expect(statuses({ ...TICKET_3, gross_lbs: -79_740 }).net_weight).toBe("not_checked");
  });

  it("nothing read means nothing checked and nothing failed", () => {
    const empty = Object.fromEntries(CHECKED_FIELDS.map((f) => [f, null])) as unknown as TicketCheckInput;
    const checks = checkTicket(empty, HARVEST);
    expect(checks.every((c) => c.status === "not_checked")).toBe(true);
    expect(fieldsInFailedChecks(checks).size).toBe(0);
  });
});

describe("every check", () => {
  it("says one sentence and names the values it compares", () => {
    for (const ticket of [TICKET_3, { ...TICKET_3, gross_lbs: 77_740, moisture_pct: null }]) {
      for (const check of checkTicket(ticket, HARVEST)) {
        expect(check.message).toMatch(/^[A-Z0-9].*\.$/);
        expect(check.fields.length).toBeGreaterThan(0);
        for (const field of check.fields) expect(CHECKED_FIELDS).toContain(field);
      }
    }
  });
});
