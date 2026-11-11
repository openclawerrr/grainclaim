/**
 * npm run read-document -- <file>   read one FSA map, FSA-578 or Summary of Coverage (a
 *                                   photo or a PDF), print its values and checks
 * npm run score-documents           read the sample FSA map and FSA-578 photos and the
 *                                   Summary of Coverage PDF with each model and score
 *                                   every value against documents-2026.json
 *
 * Server-side only: reads ANTHROPIC_API_KEY from .env.local and never prints it.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOCUMENT_KINDS, type ReadDocument } from "../../lib/extract/document-kinds";
import { READ_MODELS, readCostUsd, type ReadModelKey } from "../../lib/extract/models";
import type { ReadResult } from "../../lib/extract/read";
import { scoreValues, summarizeDocuments, type ScoredDocumentRead } from "../../lib/extract/score-document";
import { listOf } from "../../lib/rules/document-checks";
import { loadDocumentsFile } from "../print/documents-file";
import { loadEnvFile, mapAFewAtOnce, reportFailure } from "../read-tickets/run";
import { parseArgs, USAGE, type Command } from "./args";
import {
  formatChecks,
  formatDocumentComparison,
  formatDocumentScore,
  formatValues,
  type DocumentModelScore,
} from "./report";
import { matchDocuments, type SampleDocument } from "./sample-documents";

const SAMPLE_DIR = path.resolve("sample-data");

// ---------------------------------------------------------------------------
// read-document
// ---------------------------------------------------------------------------

async function readOne(command: Extract<Command, { kind: "read" }>): Promise<void> {
  const kind = DOCUMENT_KINDS[command.document];
  const result = await kind.read(readFileSync(command.file), { model: command.model });
  const model = READ_MODELS[result.model];
  const cost = readCostUsd(result.model, result.usage);
  console.log(
    `${path.basename(command.file)} (${kind.title}), read by ${model.name} in ${result.seconds.toFixed(1)} s ($${cost.toFixed(4)})\n`,
  );
  if (!result.ok) {
    console.log(`The read failed: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatValues(result.values.values).join("\n"));
  console.log("\nChecks");
  console.log(formatChecks(result.values.checks).join("\n"));
}

// ---------------------------------------------------------------------------
// score-documents
// ---------------------------------------------------------------------------

interface SavedRead {
  document: string;
  run: number;
  result: ReadResult<ReadDocument>;
  scored: ScoredDocumentRead;
}

async function scoreModel(
  model: ReadModelKey,
  documents: readonly SampleDocument[],
  runs: number,
): Promise<{ score: DocumentModelScore; reads: SavedRead[] }> {
  const jobs = documents.flatMap((document) => Array.from({ length: runs }, (_, i) => ({ document, run: i + 1 })));
  const files = new Map(documents.map((d) => [d.name, readFileSync(path.join(SAMPLE_DIR, d.file))]));

  const reads = await mapAFewAtOnce(jobs, async ({ document, run }): Promise<SavedRead> => {
    const result = await DOCUMENT_KINDS[document.kind].read(files.get(document.name)!, { model });
    const scored: ScoredDocumentRead = {
      document: document.name,
      run,
      failure: result.ok ? null : result.reason,
      values: scoreValues(result.ok ? result.values.values : null, document.expected),
      checks: result.ok ? result.values.checks : [],
    };
    const right = scored.values.filter((v) => v.correct).length;
    console.log(
      `  ${READ_MODELS[model].name}  ${document.name} run ${run}: ` +
        (result.ok ? `${right}/${scored.values.length} values` : `failed (${result.reason})`),
    );
    return { document: document.name, run, result, scored };
  });

  const score: DocumentModelScore = {
    model,
    effort: reads[0].result.effort,
    runs,
    summary: summarizeDocuments(reads.map((r) => r.scored)),
    spent: documents.map((document) => {
      const own = reads.filter((r) => r.document === document.name);
      return {
        document: document.name,
        reads: own.length,
        usage: {
          input_tokens: own.reduce((total, r) => total + r.result.usage.input_tokens, 0),
          output_tokens: own.reduce((total, r) => total + r.result.usage.output_tokens, 0),
        },
        seconds: own.reduce((total, r) => total + r.result.seconds, 0),
      };
    }),
  };
  return { score, reads };
}

async function scoreAll(command: Extract<Command, { kind: "score" }>): Promise<void> {
  const match = matchDocuments(
    readdirSync(path.join(SAMPLE_DIR, "photos")),
    readdirSync(path.join(SAMPLE_DIR, "print")),
    loadDocumentsFile(),
  );
  if (match.problems.length > 0) {
    throw new Error(`The sample files and documents-2026.json don't line up:\n- ${match.problems.join("\n- ")}`);
  }
  if (match.documents.length === 0) {
    throw new Error("documents-2026.json has no FSA map, FSA-578 or Summary of Coverage to read.");
  }

  const { documents } = match;
  console.log(
    `Reading ${listOf(documents.map((d) => `${DOCUMENT_KINDS[d.kind].title} (${d.file})`))}, ` +
      `${command.runs} time${command.runs === 1 ? "" : "s"} each, with ${command.models.map((m) => READ_MODELS[m].name).join(" and ")}.\n`,
  );

  const results = [];
  for (const model of command.models) {
    results.push(await scoreModel(model, documents, command.runs));
  }

  for (const { score } of results) {
    console.log(`\n${formatDocumentScore(score).join("\n")}`);
  }
  console.log(`\n${formatDocumentComparison(results.map((r) => r.score)).join("\n")}`);

  if (command.jsonPath) {
    const saved = {
      sample: true,
      scored_at: new Date().toISOString(),
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
  if (command.kind === "read") await readOne(command);
  else await scoreAll(command);
}

main().catch(reportFailure);
