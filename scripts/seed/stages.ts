/**
 * The seed loads the sample farm in stages, in this order. `npm run seed`
 * loads them all; `npm run seed -- --through <stage>` stops after one, so a
 * demo can start from that point and do the rest live.
 *
 * To add a demo stage in a later milestone (harvest, tickets, settlement,
 * winter-pickup, hail-notice): add its data file to sample-data/, add one
 * entry at the end of STAGES, and if it creates rows in a table reset.ts
 * doesn't cover yet, add that table there.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SampleTable } from "./reset";
import {
  binRows,
  buyerRows,
  fieldRows,
  fieldSeasonRows,
  insuredRows,
  policyRows,
  truckRows,
  unitRows,
  type SampleFiles,
} from "./sample-files";

export interface StageContext {
  db: SupabaseClient;
  files: SampleFiles;
}

export interface Stage {
  name: string;
  description: string;
  /** Rows this stage adds, by table, inserted in the order listed. verify.ts checks the totals. */
  rows(files: SampleFiles): Partial<Record<SampleTable, Record<string, unknown>[]>>;
  /** Optional work after the rows are in, such as uploading ticket photos to Storage. */
  afterRows?(ctx: StageContext): Promise<void>;
}

/**
 * The bin Dave adds from the map in demo beat 1. farm-base leaves it out so
 * he can, and the stage after it loads it for everyone who starts later.
 */
export const LIVE_BIN_NAME = "Bin 3";
const isLiveBin = (bin: { name: string }) => bin.name === LIVE_BIN_NAME;

export const STAGES: readonly Stage[] = [
  {
    // Demo beat 1 starts here: the farm exists but has no fields and no
    // Bin 3 yet. The fields are imported and Bin 3 is added live.
    name: "farm-base",
    description: "insured, Main Street Elevator, Bin 4, Trucks 1 and 2 (no Bin 3, no fields)",
    rows: (files) => ({
      insured: insuredRows(files),
      buyer: buyerRows(files),
      bin: binRows(files).filter((bin) => !isLiveBin(bin)),
      truck: truckRows(files),
    }),
  },
  {
    name: "bin-3",
    description: "Bin 3, which demo beat 1 adds live from the map",
    rows: (files) => ({ bin: binRows(files).filter(isLiveBin) }),
  },
  {
    name: "fields",
    description: "North 80 and South 40 from sample-data/farm.geojson",
    rows: (files) => ({ field: fieldRows(files) }),
  },
  {
    name: "season-2026",
    description: "2026 corn policy, Units 1 and 2, field seasons",
    rows: (files) => ({
      policy: policyRows(files),
      unit: unitRows(files),
      field_season: fieldSeasonRows(files),
    }),
  },
];

export const STAGE_NAMES = STAGES.map((s) => s.name);

/** The stages from the first one up to and including `name`. */
export function stagesThrough(name: string, stages: readonly Stage[] = STAGES): Stage[] {
  const end = stages.findIndex((s) => s.name === name);
  if (end === -1) {
    throw new Error(`Unknown stage "${name}". Stages: ${stages.map((s) => s.name).join(", ")}.`);
  }
  return stages.slice(0, end + 1);
}

/** Inserts a stage's rows, table by table in the order the stage lists them. */
export async function loadStage(stage: Stage, { db, files }: StageContext): Promise<void> {
  for (const [table, rows] of Object.entries(stage.rows(files))) {
    if (!rows || rows.length === 0) continue;
    const { error } = await db.from(table).insert(rows);
    if (error) {
      throw new Error(`Stage ${stage.name}: inserting into ${table} failed: ${error.message}`);
    }
  }
  await stage.afterRows?.({ db, files });
}
