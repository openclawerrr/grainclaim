/**
 * npm run read-ticket -- <photo>   read one ticket photo, print its values and checks
 * npm run score-tickets            read every sample ticket photo with each model and
 *                                  score the values against documents-2026.json
 *
 * Server-side only: reads ANTHROPIC_API_KEY from .env.local and never prints it.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { READ_MODELS, readCostUsd, type ReadModelKey } from "../../lib/extract/models";
import { readTicket, type TicketReadResult } from "../../lib/extract/read-ticket";
import { scoreRead, summarize, type ScoredRead } from "../../lib/extract/score";
import { checkTicket, type HarvestWindow } from "../../lib/rules/ticket-checks";
import { loadDocumentsFile } from "../print/documents-file";
import { loadSampleFiles } from "../seed/sample-files";
import { parseArgs, USAGE, type Command } from "./args";
import { formatChecks, formatComparison, formatModelScore, formatValues, type ModelScore } from "./report";
import { loadEnvFile, mapAFewAtOnce, reportFailure } from "./run";
import { matchPhotos, sampleHarvestWindow, type SampleTicket } from "./sample-tickets";

const PHOTOS_DIR = path.resolve("sample-data", "photos");

// ---------------------------------------------------------------------------
// read-ticket
// ---------------------------------------------------------------------------

async function readOne(command: Extract<Command, { kind: "read" }>, harvest: HarvestWindow): Promise<void> {
  const photo = readFileSync(command.photo);
  const result = await readTicket(photo, { model: command.model });
  const model = READ_MODELS[result.model];
  const cost = readCostUsd(result.model, result.usage);
  console.log(
    `${path.basename(command.photo)}, read by ${model.name} in ${result.seconds.toFixed(1)} s ($${cost.toFixed(4)})\n`,
  );
  if (!result.ok) {
    console.log(`The read failed: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatValues(result.values).join("\n"));
  console.log("\nChecks");
  console.log(formatChecks(checkTicket(result.values, harvest)).join("\n"));
}

// ---------------------------------------------------------------------------
// score-tickets
// ---------------------------------------------------------------------------

interface SavedRead {
  ticket: string;
  run: number;
  result: TicketReadResult;
  scored: ScoredRead;
}

async function scoreModel(
  model: ReadModelKey,
  tickets: readonly SampleTicket[],
  runs: number,
  harvest: HarvestWindow,
): Promise<{ score: ModelScore; reads: SavedRead[] }> {
  const jobs = tickets.flatMap((ticket) => Array.from({ length: runs }, (_, i) => ({ ticket, run: i + 1 })));
  const photos = new Map(tickets.map((t) => [t.name, readFileSync(path.join(PHOTOS_DIR, t.photo))]));

  const reads = await mapAFewAtOnce(jobs, async ({ ticket, run }): Promise<SavedRead> => {
    const result = await readTicket(photos.get(ticket.name)!, { model });
    const values = result.ok ? result.values : null;
    const scored: ScoredRead = {
      ticket: ticket.name,
      run,
      filledIn: ticket.filledIn,
      failure: result.ok ? null : result.reason,
      fields: scoreRead(values, ticket.expected),
      checks: values ? checkTicket(values, harvest) : [],
    };
    const right = scored.fields.filter((f) => f.correct).length;
    console.log(
      `  ${READ_MODELS[model].name}  ${ticket.name} run ${run}: ` +
        (result.ok ? `${right}/${scored.fields.length} values` : `failed (${result.reason})`),
    );
    return { ticket: ticket.name, run, result, scored };
  });

  const score: ModelScore = {
    model,
    effort: reads[0].result.effort,
    tickets: tickets.length,
    runs,
    summary: summarize(reads.map((r) => r.scored)),
    usage: {
      input_tokens: reads.reduce((total, r) => total + r.result.usage.input_tokens, 0),
      output_tokens: reads.reduce((total, r) => total + r.result.usage.output_tokens, 0),
    },
    seconds: reads.reduce((total, r) => total + r.result.seconds, 0),
  };
  return { score, reads };
}

async function scoreAll(command: Extract<Command, { kind: "score" }>, harvest: HarvestWindow): Promise<void> {
  const match = matchPhotos(readdirSync(PHOTOS_DIR), loadDocumentsFile());
  if (match.problems.length > 0) {
    throw new Error(`The sample photos and documents-2026.json don't line up:\n- ${match.problems.join("\n- ")}`);
  }
  if (match.tickets.length === 0) throw new Error("There are no ticket photos in sample-data/photos.");

  const { tickets } = match;
  console.log(
    `Reading ${tickets.length} ticket photos (${tickets.map((t) => t.photo).join(", ")}), ` +
      `${command.runs} time${command.runs === 1 ? "" : "s"} each, with ${command.models.map((m) => READ_MODELS[m].name).join(" and ")}.`,
  );
  if (match.skipped.length > 0) console.log(`Not tickets, so not read: ${match.skipped.join(", ")}.`);
  console.log("");

  const results = [];
  for (const model of command.models) {
    results.push(await scoreModel(model, tickets, command.runs, harvest));
  }

  for (const { score } of results) {
    console.log(`\n${formatModelScore(score).join("\n")}`);
  }
  console.log(`\n${formatComparison(results.map((r) => r.score)).join("\n")}`);

  if (command.jsonPath) {
    const saved = {
      sample: true,
      scored_at: new Date().toISOString(),
      harvest,
      models: results.map(({ score, reads }) => ({ ...score, model_id: READ_MODELS[score.model].id, reads })),
    };
    writeFileSync(command.jsonPath, `${JSON.stringify(saved, null, 2)}\n`);
    console.log(`\nSaved every read to ${command.jsonPath}.`);
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const command = parseArgs(process.argv.slice(2));
  if (command.kind === "help") {
    console.log(USAGE);
    return;
  }
  loadEnvFile();
  const harvest = sampleHarvestWindow(loadSampleFiles().season);
  if (command.kind === "read") await readOne(command, harvest);
  else await scoreAll(command, harvest);
}

main().catch(reportFailure);
