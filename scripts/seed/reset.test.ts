import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { resetSampleFarm } from "./reset";
import { loadSampleFiles } from "./sample-files";
import { STAGES } from "./stages";

const files = loadSampleFiles();
type Row = Record<string, unknown> & { id: string };
type Tables = Record<string, Row[]>;

/**
 * Just enough of the Supabase client for reset.ts, backed by arrays. Like the
 * real database, it refuses to delete a row another row still points to
 * (every *_id column except flag.record_id is a foreign key in the schema,
 * and so is ticket.duplicate_of).
 */
function fakeDb(start: Tables) {
  const tables: Tables = structuredClone(start);
  const isForeignKey = (column: string) =>
    (column.endsWith("_id") && column !== "record_id") || column === "duplicate_of";

  const db = {
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      return {
        select: () => ({
          in: async (column: string, values: string[]) => ({
            data: rows()
              .filter((r) => values.includes(r[column] as string))
              .map((r) => ({ id: r.id })),
            error: null,
          }),
        }),
        delete: () => ({
          in: async (column: string, values: string[]) => {
            const doomed = rows().filter((r) => values.includes(r[column] as string));
            const doomedIds = new Set(doomed.map((r) => r.id));
            for (const [other, otherRows] of Object.entries(tables)) {
              for (const r of otherRows) {
                if (doomedIds.has(r.id)) continue;
                for (const [col, value] of Object.entries(r)) {
                  if (isForeignKey(col) && doomedIds.has(value as string)) {
                    return { error: { message: `${other}.${col} still points to ${table}` }, count: null };
                  }
                }
              }
            }
            tables[table] = rows().filter((r) => !doomedIds.has(r.id));
            return { error: null, count: doomed.length };
          },
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient, tables };
}

/** The sample farm as the seed loads it. */
function seededTables(): Tables {
  const tables: Tables = {};
  for (const stage of STAGES) {
    for (const [table, rows] of Object.entries(stage.rows(files))) {
      (tables[table] ??= []).push(...((rows ?? []) as Row[]));
    }
  }
  return tables;
}

const INSURED = files.farm.insured.id;
const ELEVATOR = files.farm.buyers[0].id;
const TRUCK_1 = files.farm.trucks[0].id;
const BIN_3 = files.farm.bins[0].id;

describe("resetSampleFarm", () => {
  it("removes the seeded farm and rows the app added during a demo, and nothing else", async () => {
    const tables = seededTables();
    // Demo beat 1: North 80 imported live from farm.geojson gets a new ID.
    tables.field.push({ id: "live-field", insured_id: INSURED, name: "North 80 (imported)" });
    // Harvest: a trip from it, its ticket, a farm-stored load, flags on them.
    tables.trip = [
      { id: "trip-1", truck_id: TRUCK_1, origin_field_id: "live-field", dest_buyer_id: ELEVATOR },
      { id: "trip-2", truck_id: TRUCK_1, origin_field_id: "live-field", dest_bin_id: BIN_3 },
    ];
    tables.ticket = [{ id: "ticket-1", trip_id: "trip-1" }];
    tables.flag = [
      { id: "flag-field", record_type: "field", record_id: "live-field" },
      { id: "flag-ticket", record_type: "ticket", record_id: "ticket-1" },
    ];
    // Someone else's farm on the shared database must survive.
    tables.insured.push({ id: "other-insured", name: "Test Farm" });
    tables.field.push({ id: "other-field", insured_id: "other-insured", name: "Back 40" });
    tables.truck.push({ id: "other-truck", insured_id: "other-insured", name: "Truck 9" });
    tables.trip.push({ id: "other-trip", truck_id: "other-truck", origin_field_id: "other-field", dest_buyer_id: "other-buyer" });
    tables.buyer.push({ id: "other-buyer", name: "Other Elevator" });
    tables.flag.push({ id: "other-flag", record_type: "field", record_id: "other-field" });

    const { db, tables: after } = fakeDb(tables);
    const removed = await resetSampleFarm(db, files);

    expect(removed).toEqual({
      flag: 2,
      ticket: 1,
      trip: 2,
      field_season: 2,
      unit: 2,
      policy: 1,
      truck: 2,
      bin: 2,
      field: 3,
      buyer: 1,
      insured: 1,
    });
    const left = Object.fromEntries(
      Object.entries(after).map(([t, rows]) => [t, rows.map((r) => r.id)]),
    );
    expect(left).toMatchObject({
      insured: ["other-insured"],
      field: ["other-field"],
      truck: ["other-truck"],
      trip: ["other-trip"],
      buyer: ["other-buyer"],
      flag: ["other-flag"],
      ticket: [],
      bin: [],
      policy: [],
      unit: [],
      field_season: [],
    });
  });

  it("removes second photos of a ticket, which have no trip and are found through the first ticket", async () => {
    const tables = seededTables();
    const NORTH_80 = tables.field[0].id;
    tables.trip = [{ id: "trip-1", truck_id: TRUCK_1, origin_field_id: NORTH_80, dest_buyer_id: ELEVATOR }];
    tables.ticket = [
      { id: "a-first-photo", trip_id: "trip-1", duplicate_of: null },
      { id: "b-second-photo", trip_id: null, duplicate_of: "a-first-photo" },
      { id: "c-third-photo", trip_id: null, duplicate_of: "a-first-photo" },
      // Another farm's second photo must survive.
      { id: "other-ticket", trip_id: null, duplicate_of: "other-original" },
    ];
    tables.flag = [{ id: "flag-second-photo", record_type: "ticket", record_id: "b-second-photo" }];

    const { db, tables: after } = fakeDb(tables);
    const removed = await resetSampleFarm(db, files);

    expect(removed.ticket).toBe(3);
    expect(removed.flag).toBe(1);
    expect(after.ticket.map((t) => t.id)).toEqual(["other-ticket"]);
    expect(after.trip).toEqual([]);
  });

  it("does nothing when there is no sample farm, so it can run on an empty database", async () => {
    const { db } = fakeDb({});
    const removed = await resetSampleFarm(db, files);
    expect(Object.values(removed).every((n) => n === 0)).toBe(true);
  });

  it("finishes the job when run again after stopping partway", async () => {
    const tables = seededTables();
    delete tables.field_season; // as if the first run stopped after deleting these
    const { db, tables: after } = fakeDb(tables);
    await resetSampleFarm(db, files);
    expect(Object.values(after).every((rows) => rows.length === 0)).toBe(true);
  });
});
