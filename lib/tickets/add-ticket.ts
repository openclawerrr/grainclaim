/**
 * Adds one ticket photo to the farmer's records, start to finish:
 *
 *   hash → already added? → EXIF time and GPS → read → checks → which field
 *   → bushels → same ticket as an earlier photo? → truck and buyer → store
 *   the photo → trip → ticket
 *
 * Nothing is written until the read has succeeded and every link is known.
 * The reader also says what kind of document the photo is, and a photo that
 * isn't a scale ticket is refused by name.
 * The photo is stored first: it is named by its hash, so storing the same
 * bytes again changes nothing and a retry is always safe. If the ticket can't
 * be saved after its trip was, the trip is removed.
 *
 * The reading, the photo's EXIF and the database are passed in, so this is
 * tested without Claude or Supabase (add-ticket.test.ts). The real ones are
 * wired up in app/tickets/actions.ts.
 */
import { READ_MODELS } from "../extract/models";
import type { TicketReadResult } from "../extract/read-ticket";
import { OTHER_PRINTED_FIELDS, PART_2_FIELDS, type TicketRead } from "../extract/ticket-schema";
import { photoType, sha256Hex, ticketPhotoPath, type CaptureInfo, type PhotoType } from "../photos/photo-file";
import type { Role } from "../role/role";
import { wrongKindMessage } from "../rules/document-kind";
import { RuleInputError } from "../rules/errors";
import { originOfLoad } from "../rules/load-origin";
import { CALC_VERSION, ticketBushels, type TicketBushels } from "../rules/ticket-bushels";
import { checkTicket, type HarvestWindow, type TicketCheck } from "../rules/ticket-checks";
import { findOriginalTicket, matchBuyer, matchFarmTruck, type SavedTicketIdentity } from "../rules/ticket-matching";
import { FARM_TIME_ZONE } from "./farm-time-zone";

// ---------------------------------------------------------------------------
// What the pipeline needs from the database (implemented in lib/db/ticket-store.ts)
// ---------------------------------------------------------------------------

export interface FarmRecords {
  fields: { id: string; name: string }[];
  fieldSeasons: { field_id: string; crop_year: number; crop: string; planting_completed_date: string | null }[];
  /** Farm trucks only. */
  trucks: { id: string; name: string; capacity_bu: number }[];
  buyers: { id: string; name: string }[];
}

/** A trip row to insert. The database adds the id and the trip code. */
export interface NewTrip {
  truck_id: string;
  origin_field_id: string;
  dest_buyer_id: string;
  crop_year: number;
  /** Left out when the ticket has no date; the database then uses the time it was saved. */
  started_at?: string;
  estimated_bu: number;
  moisture_pct: number | null;
  status: "closed";
  trust: "manual";
}

/** A ticket row to insert: the photo, the read values and the calculated bushels. */
export type NewTicket = Record<string, unknown> & {
  trip_id: string | null;
  duplicate_of: string | null;
  photo_path: string;
  photo_sha256: string;
};

export interface TicketStore {
  findTicketByHash(hash: string): Promise<{ id: string } | null>;
  loadFarmRecords(): Promise<FarmRecords>;
  /** Saved tickets with this number and date, for the duplicate check. */
  findTicketsByNumberAndDate(ticketNumber: string, ticketDate: string): Promise<SavedTicketIdentity[]>;
  /** Stores the original file. Storing bytes that are already there is not an error. */
  savePhoto(path: string, photo: Uint8Array, type: PhotoType): Promise<void>;
  insertTrip(trip: NewTrip): Promise<{ id: string }>;
  deleteTrip(id: string): Promise<void>;
  insertTicket(ticket: NewTicket): Promise<{ id: string }>;
}

export interface AddTicketDeps {
  store: TicketStore;
  read(photo: Uint8Array): Promise<TicketReadResult>;
  captureInfo(photo: Uint8Array): Promise<CaptureInfo>;
  now(): Date;
}

export type AddTicketOutcome =
  /** Saved with its trip. It counts toward its unit's total. */
  | { status: "saved"; ticketId: string }
  /** Saved, but it is a second photo of a ticket already on record, so it has no trip and isn't counted. */
  | { status: "duplicate"; ticketId: string; originalTicketId: string }
  /** These exact bytes were added before. Nothing new was saved. */
  | { status: "already_added"; ticketId: string }
  /** Nothing was saved. `message` is one plain sentence for the farmer; `detail` is for the server log. */
  | { status: "not_saved"; message: string; detail?: string };

// ---------------------------------------------------------------------------

function notSaved(message: string, detail?: string): AddTicketOutcome {
  return { status: "not_saved", message, detail };
}

/** The field's season for the ticket's year, or its newest season when the date wasn't read. */
function seasonFor(fieldId: string, ticketDate: string | null, farm: FarmRecords) {
  const seasons = farm.fieldSeasons.filter((fs) => fs.field_id === fieldId).sort((a, b) => b.crop_year - a.crop_year);
  const year = ticketDate ? Number(ticketDate.slice(0, 4)) : null;
  return seasons.find((fs) => fs.crop_year === year) ?? seasons[0] ?? null;
}

/** Harvest for a field season: after planting finished, through the end of the crop year. */
function harvestWindow(season: { crop_year: number; planting_completed_date: string | null }): HarvestWindow {
  return {
    after: season.planting_completed_date ?? `${season.crop_year - 1}-12-31`,
    through: `${season.crop_year}-12-31`,
  };
}

/** The ticket's printed date and time in, as a moment Postgres can read. Noon when no time was read. */
export function tripStartedAt(ticketDate: string | null, ticketTime: string | null): string | undefined {
  if (ticketDate === null) return undefined;
  return `${ticketDate} ${ticketTime ?? "12:00"} ${FARM_TIME_ZONE}`;
}

function pick<K extends keyof TicketRead>(values: TicketRead, keys: readonly K[]): Pick<TicketRead, K> {
  return Object.fromEntries(keys.map((key) => [key, values[key]])) as Pick<TicketRead, K>;
}

interface TicketRowInput {
  path: string;
  hash: string;
  capture: CaptureInfo;
  who: Role;
  read: Extract<TicketReadResult, { ok: true }>;
  checks: TicketCheck[];
  bushels: TicketBushels;
  readAt: Date;
  tripId: string | null;
  duplicateOf: string | null;
}

function ticketRow(input: TicketRowInput): NewTicket {
  const { capture, read, bushels } = input;
  return {
    trip_id: input.tripId,
    duplicate_of: input.duplicateOf,

    // The original photo.
    photo_path: input.path,
    photo_sha256: input.hash,
    captured_at: capture.capturedAt,
    capture_location: capture.location
      ? `SRID=4326;POINT(${capture.location.longitude} ${capture.location.latitude})`
      : null,
    source: "upload",
    uploaded_by: input.who,

    // What was read, as read. These lock once saved.
    ...pick(read.values, PART_2_FIELDS),
    other_printed_values: pick(read.values, OTHER_PRINTED_FIELDS),
    read_confidence: { checks: input.checks },
    read_model: READ_MODELS[read.model].id,
    read_at: input.readAt.toISOString(),

    // What was calculated from it.
    wet_bu: bushels.wet_bu,
    elevator_dry_bu: bushels.elevator_dry_bu,
    production_to_count_bu: bushels.production_to_count_bu,
    calc_version: CALC_VERSION,

    // The field wasn't confirmed by a location or printed on the ticket.
    trust: "manual",
  };
}

export async function addTicket(photo: Uint8Array, who: Role, deps: AddTicketDeps): Promise<AddTicketOutcome> {
  const { store } = deps;

  const type = photoType(photo);
  if (!type) return notSaved("That file isn't a JPEG or PNG photo. Choose a photo of the ticket.");

  const hash = sha256Hex(photo);
  const sameBytes = await store.findTicketByHash(hash);
  if (sameBytes) return { status: "already_added", ticketId: sameBytes.id };

  // Loaded before the read, so a farm that isn't set up fails before Claude is paid.
  const farm = await store.loadFarmRecords();
  const capture = await deps.captureInfo(photo);

  const read = await deps.read(photo);
  if (!read.ok) {
    // Not a scale ticket (a settlement, say): nothing of it is saved.
    if (read.wrongKind) return notSaved(wrongKindMessage("scale_ticket", read.wrongKind), read.reason);
    return notSaved("The ticket couldn't be read, so nothing was saved. Try again, or use a clearer photo.", read.reason);
  }
  const values = read.values;

  let origin;
  try {
    origin = originOfLoad({ ticket: values, fields: farm.fields });
  } catch (error) {
    if (error instanceof RuleInputError) return notSaved(`${error.message} Nothing was saved.`);
    throw error;
  }
  if (origin.kind !== "field") {
    return notSaved("This load came from a bin, and tickets for grain sold from a bin can't be saved yet.");
  }
  const fieldId = origin.fieldId;
  const fieldName = farm.fields.find((f) => f.id === fieldId)?.name ?? "That field";
  const season = seasonFor(fieldId, values.ticket_date, farm);
  if (!season) {
    return notSaved(`${fieldName} has no season set up yet, so this ticket can't be linked to a unit. Nothing was saved.`);
  }

  const checks = checkTicket(values, harvestWindow(season));
  // The crop comes from the ticket; the field's season fills in when the ticket doesn't say.
  const bushels = ticketBushels({ ...values, crop: values.crop ?? season.crop });

  const path = ticketPhotoPath(hash, type);
  const row = { path, hash, capture, who, read, checks, bushels, readAt: deps.now() };

  // The same buyer, number and date is the same ticket, whatever the photo.
  const original =
    values.ticket_number !== null && values.ticket_date !== null
      ? findOriginalTicket(values, await store.findTicketsByNumberAndDate(values.ticket_number, values.ticket_date))
      : null;
  if (original) {
    await store.savePhoto(path, photo, type);
    const ticket = await store.insertTicket(ticketRow({ ...row, tripId: null, duplicateOf: original.id }));
    return { status: "duplicate", ticketId: ticket.id, originalTicketId: original.id };
  }

  // THIN SLICE: a trip needs a truck and an estimate until Milestone 4, so a
  // ticket whose truck or buyer isn't on record can't be saved yet.
  const truck = matchFarmTruck(values.truck_number, farm.trucks);
  if (!truck) {
    return notSaved(
      values.truck_number === null
        ? "The truck number couldn't be read from the ticket, so it can't be saved yet."
        : `The ticket says truck "${values.truck_number}", which isn't one of your trucks, so it can't be saved yet.`,
    );
  }
  const buyer = matchBuyer(values.buyer_name, farm.buyers);
  if (!buyer) {
    return notSaved(
      values.buyer_name === null
        ? "The buyer's name couldn't be read from the ticket, so it can't be saved yet."
        : `The ticket is from "${values.buyer_name}", which isn't one of your buyers, so it can't be saved yet.`,
    );
  }

  await store.savePhoto(path, photo, type);
  const trip = await store.insertTrip({
    truck_id: truck.id,
    origin_field_id: fieldId,
    dest_buyer_id: buyer.id,
    crop_year: season.crop_year,
    started_at: tripStartedAt(values.ticket_date, values.ticket_time),
    // The field harvest record needs an estimate for every load: the truck's capacity.
    estimated_bu: truck.capacity_bu,
    moisture_pct: values.moisture_pct,
    // The ticket closes the trip in the same step that creates it.
    status: "closed",
    trust: "manual",
  });
  try {
    const ticket = await store.insertTicket(ticketRow({ ...row, tripId: trip.id, duplicateOf: null }));
    return { status: "saved", ticketId: ticket.id };
  } catch (error) {
    await store.deleteTrip(trip.id).catch(() => undefined);
    throw error;
  }
}
