/**
 * npm run seed: removes Dave's sample farm and loads it again from
 * sample-data/. See `npm run seed -- --help` and sample-data/README.md.
 *
 * The database is shared: seeding replaces the sample farm for everyone,
 * so tell the team before running it.
 */
import { parseSeedArgs, usage } from "./args";
import { createSeedClient } from "./db";
import { resetSampleFarm, type SampleTable } from "./reset";
import { loadSampleFiles } from "./sample-files";
import { loadStage, STAGE_NAMES, STAGES, stagesThrough } from "./stages";
import { verifySampleFarm } from "./verify";

function summary(counts: Record<SampleTable, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => `${table} ${n}`);
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

async function main(): Promise<void> {
  const command = parseSeedArgs(process.argv.slice(2), STAGE_NAMES);

  if (command.kind === "help") {
    console.log(usage(STAGE_NAMES));
    return;
  }
  if (command.kind === "list") {
    for (const stage of STAGES) console.log(`${stage.name.padEnd(12)} ${stage.description}`);
    return;
  }

  // Check the files before touching the database.
  const files = loadSampleFiles();
  const db = createSeedClient();

  console.log("Removing the sample farm (audit_event keeps its history)...");
  const removed = await resetSampleFarm(db, files);
  console.log(`  removed: ${summary(removed)}`);

  const stages = command.kind === "load" ? stagesThrough(command.through) : [];
  for (const stage of stages) {
    console.log(`Loading ${stage.name}: ${stage.description}`);
    await loadStage(stage, { db, files });
  }

  const { counts, problems } = await verifySampleFarm(db, files, stages);
  if (problems.length > 0) {
    console.error(`Check failed:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  const loaded = stages.length > 0 ? `through ${stages[stages.length - 1].name}` : "no stages";
  console.log(`Done (${loaded}). Sample rows now: ${summary(counts)}`);
}

main().catch((err: unknown) => {
  console.error(`Seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
