/**
 * Removes the sample farm so the seed can load it fresh.
 *
 * How it works:
 * 1. Start from the fixed IDs in sample-data/ (the insured and the elevator
 *    are the roots).
 * 2. Collect everything that belongs to them, including rows the app made
 *    during a demo: fields imported live from farm.geojson, trips, tickets on
 *    those trips, flags on any of these rows.
 * 3. Delete children first, one table at a time, by ID.
 *
 * audit_event is never touched. It is append-only (a trigger blocks update
 * and delete), and every delete here adds a 'delete' row to it, so a sample
 * record's history shows each reset. Never use TRUNCATE: it skips row
 * triggers, so it would bypass both the audit trail and the append-only guard.
 *
 * The REST API has no transactions, so a reset is not atomic. Each step is
 * "delete these IDs", so running it again after a failure finishes the job.
 * Because the IDs are fixed, a row that survives makes the next insert fail
 * on its primary key instead of creating a second sample farm.
 *
 * A second photo of a ticket already on record has no trip. It is found
 * through duplicate_of, which points at the first ticket, and deleted before
 * the ticket it points to.
 *
 * Photo files are left in Storage. Each is named by its hash, so adding the
 * same photo after a reset stores nothing new.
 *
 * Gaps for later stages:
 * - Any other ticket with no trip (the late emailed ticket, before it
 *   matches its pickup) has no link back to the farm. The tickets stage must
 *   also delete tickets by the SHA-256 hashes of the photos in sample-data/,
 *   or the unique-hash rule will block re-seeding.
 * - A new table that hangs off the farm needs a line in collectSampleRows and
 *   a place in DELETE_ORDER.
 * - Tickets can be deleted today because the lock trigger covers updates
 *   only. If deletes get blocked, reset will need its own SQL function.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixedIds, type SampleFiles } from "./sample-files";

/** Tables the sample farm has rows in, children first (the order to delete in). */
export const DELETE_ORDER = [
  "flag",
  "ticket",
  "trip",
  "field_season",
  "unit",
  "policy",
  "truck",
  "bin",
  "field",
  "buyer",
  "insured",
] as const;
export type SampleTable = (typeof DELETE_ORDER)[number];
export type SampleRowIds = Record<SampleTable, string[]>;

/** PostgREST puts IDs in the URL, so long lists are sent in chunks. */
const CHUNK = 100;

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK));
  return out;
}

function union(...lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}

/** IDs of rows in `table` whose `column` is one of `values`. */
async function idsWhere(
  db: SupabaseClient,
  table: SampleTable,
  column: string,
  values: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const chunk of chunks(values)) {
    const { data, error } = await db.from(table).select("id").in(column, chunk);
    if (error) throw new Error(`Reading ${table} by ${column} failed: ${error.message}`);
    ids.push(...data.map((row: { id: string }) => row.id));
  }
  return ids;
}

/** Every row that belongs to the sample farm, found from the fixed IDs. */
export async function collectSampleRows(
  db: SupabaseClient,
  files: SampleFiles,
): Promise<SampleRowIds> {
  const fixed = fixedIds(files);
  const where = (table: SampleTable, column: string, values: string[]) =>
    idsWhere(db, table, column, values);

  const insured = union(fixed.insured);
  const buyer = union(fixed.buyer);
  const field = union(fixed.field, await where("field", "insured_id", insured));
  const bin = union(fixed.bin, await where("bin", "insured_id", insured));
  const truck = union(
    fixed.truck,
    await where("truck", "insured_id", insured),
    await where("truck", "buyer_id", buyer),
  );
  const policy = union(fixed.policy, await where("policy", "insured_id", insured));
  const unit = union(fixed.unit, await where("unit", "policy_id", policy));
  const field_season = union(
    fixed.field_season,
    await where("field_season", "field_id", field),
    await where("field_season", "unit_id", unit),
  );
  const trip = union(
    await where("trip", "truck_id", truck),
    await where("trip", "origin_field_id", field),
    await where("trip", "origin_bin_id", bin),
    await where("trip", "dest_bin_id", bin),
    await where("trip", "dest_buyer_id", buyer),
  );
  const onTrips = await where("ticket", "trip_id", trip);
  const ticket = union(onTrips, await where("ticket", "duplicate_of", onTrips));
  const flag = union(
    await where(
      "flag",
      "record_id",
      union(insured, buyer, field, bin, truck, policy, unit, field_season, trip, ticket),
    ),
  );

  return { flag, ticket, trip, field_season, unit, policy, truck, bin, field, buyer, insured };
}

/** Deletes the sample farm. Returns how many rows each table lost. */
export async function resetSampleFarm(
  db: SupabaseClient,
  files: SampleFiles,
): Promise<Record<SampleTable, number>> {
  const rows = await collectSampleRows(db, files);
  const removed = Object.fromEntries(DELETE_ORDER.map((t) => [t, 0])) as Record<SampleTable, number>;

  // Second photos point at the first ticket, so they go before the tickets they point to.
  for (const chunk of chunks(rows.ticket)) {
    const { error, count } = await db.from("ticket").delete({ count: "exact" }).in("duplicate_of", chunk);
    if (error) throw new Error(`Deleting second photos of tickets failed: ${error.message}`);
    removed.ticket += count ?? 0;
  }

  for (const table of DELETE_ORDER) {
    for (const chunk of chunks(rows[table])) {
      const { error, count } = await db.from(table).delete({ count: "exact" }).in("id", chunk);
      if (error) throw new Error(`Deleting from ${table} failed: ${error.message}`);
      removed[table] += count ?? 0;
    }
  }
  return removed;
}
