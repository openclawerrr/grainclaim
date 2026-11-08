/**
 * Checks the database after a seed: the sample farm has exactly the rows the
 * loaded stages put in, there is one sample insured, and the values the
 * database calculates (field acres, bin capacity) match the sample files.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectSampleRows, DELETE_ORDER, type SampleTable } from "./reset";
import type { SampleFiles } from "./sample-files";
import type { Stage } from "./stages";

export type RowCounts = Record<SampleTable, number>;

/** Row counts the loaded stages should leave behind (0 for every other table). */
export function expectedCounts(stages: readonly Stage[], files: SampleFiles): RowCounts {
  const counts = Object.fromEntries(DELETE_ORDER.map((t) => [t, 0])) as RowCounts;
  for (const stage of stages) {
    for (const [table, rows] of Object.entries(stage.rows(files))) {
      counts[table as SampleTable] += rows?.length ?? 0;
    }
  }
  return counts;
}

async function existing(db: SupabaseClient, table: SampleTable, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await db.from(table).select("*").in("id", ids);
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return data as Record<string, unknown>[];
}

export interface VerifyResult {
  counts: RowCounts;
  problems: string[];
}

export async function verifySampleFarm(
  db: SupabaseClient,
  files: SampleFiles,
  loaded: readonly Stage[],
): Promise<VerifyResult> {
  const problems: string[] = [];
  const expected = expectedCounts(loaded, files);
  const ids = await collectSampleRows(db, files);

  const counts = {} as RowCounts;
  const rows = {} as Record<SampleTable, Record<string, unknown>[]>;
  for (const table of DELETE_ORDER) {
    rows[table] = await existing(db, table, ids[table]);
    counts[table] = rows[table].length;
    if (counts[table] !== expected[table]) {
      problems.push(`${table}: expected ${expected[table]} sample rows, found ${counts[table]}`);
    }
  }

  // Exactly one sample farm, even counting rows that lost their fixed ID.
  const { count, error } = await db
    .from("insured")
    .select("id", { count: "exact", head: true })
    .eq("name", files.farm.insured.name);
  if (error) throw new Error(`Counting insured failed: ${error.message}`);
  if ((count ?? 0) !== expected.insured) {
    problems.push(
      `insured: expected ${expected.insured} named "${files.farm.insured.name}", found ${count ?? 0}`,
    );
  }

  for (const row of rows.field) {
    const feature = files.fields.find((f) => f.id === row.id);
    if (feature && Number(row.mapped_acres) !== feature.properties.expected_acres) {
      problems.push(
        `${feature.properties.name}: database calculates ${row.mapped_acres} acres, ` +
          `sample-data says ${feature.properties.expected_acres}`,
      );
    }
  }

  for (const row of rows.bin) {
    const bin = files.farm.bins.find((b) => b.id === row.id);
    if (bin && Number(row.capacity_bu) !== bin.expected_capacity_bu) {
      problems.push(
        `${bin.name}: database calculates ${row.capacity_bu} bu, ` +
          `sample-data says ${bin.expected_capacity_bu}`,
      );
    }
  }

  return { counts, problems };
}
