/** Turns document reads and scores into the text the commands print. Pure. */
import { READ_MODELS, readCostUsd, type ReadModelKey, type ReadUsage } from "../../lib/extract/models";
import { percent, type Tally } from "../../lib/extract/score";
import type {
  DocumentMiss,
  DocumentScoreSummary,
  DocumentValue,
  NamedValue,
} from "../../lib/extract/score-document";
import type { DocumentCheck } from "../../lib/rules/document-checks";

const CHECK_MARKS: Record<DocumentCheck["status"], string> = { pass: "✓", fail: "✗", not_checked: "–" };

const show = (value: DocumentValue | undefined) => (value === null || value === undefined ? "(none)" : String(value));
const dollars = (usd: number) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const widest = (labels: readonly string[]) => Math.max(...labels.map((label) => label.length));

export function formatValues(values: readonly NamedValue[]): string[] {
  const width = widest(values.map((v) => v.label));
  return values.map((v) => `  ${v.label.padEnd(width)}  ${show(v.value)}`);
}

export function formatChecks(checks: readonly DocumentCheck[]): string[] {
  return checks.map((check) => `  ${CHECK_MARKS[check.status]} ${check.message}`);
}

// ---------------------------------------------------------------------------
// One model's score
// ---------------------------------------------------------------------------

export interface DocumentModelScore {
  model: ReadModelKey;
  effort: string;
  runs: number;
  summary: DocumentScoreSummary;
  /** What reading each document took, added up over its runs, in the order of `summary.documents`. */
  spent: {
    document: string;
    reads: number;
    /** Tokens billed across this document's reads. */
    usage: ReadUsage;
    /** Seconds across this document's reads, added up. */
    seconds: number;
  }[];
}

function totalCost(score: DocumentModelScore): number {
  return score.spent.reduce((total, s) => total + readCostUsd(score.model, s.usage), 0);
}

/** What one read of every document costs: each document's average, added up. */
export function costPerSet(score: DocumentModelScore): number {
  return score.spent.reduce((total, s) => total + readCostUsd(score.model, s.usage) / s.reads, 0);
}

/** How long one read of every document takes, one after another. */
export function secondsPerSet(score: DocumentModelScore): number {
  return score.spent.reduce((total, s) => total + s.seconds / s.reads, 0);
}

function tallyLine(label: string, tally: Tally, width: number): string {
  return `  ${label.padEnd(width)} ${`${tally.correct}/${tally.total}`.padStart(9)}  ${percent(tally).padStart(6)}`;
}

function heading(score: DocumentModelScore): string {
  const model = READ_MODELS[score.model];
  const reads = `${count(score.summary.reads, "read")} (${count(score.summary.documents.length, "document")} × ${count(score.runs, "run")})`;
  return `${model.name} (${model.id}), effort ${score.effort}: ${reads}`;
}

function describeMiss(miss: DocumentMiss): string {
  switch (miss.kind) {
    case "blank":
      return `left blank, expected ${show(miss.expected)}`;
    case "missing":
      return `not in the read, expected ${show(miss.expected)}`;
    case "extra":
      return `read ${show(miss.read)}, but the document has no such row`;
    case "wrong":
      return `read ${show(miss.read)}, expected ${show(miss.expected)}`;
  }
}

function caughtNote(miss: DocumentMiss): string {
  if (miss.kind === "blank" || miss.kind === "missing") return "";
  if (miss.caughtBy.length > 0) return `  (caught by ${[...new Set(miss.caughtBy)].join(", ")})`;
  return miss.checkable ? "  (every check passed)" : "  (no check uses this value)";
}

export function formatDocumentScore(score: DocumentModelScore): string[] {
  const { summary } = score;
  const lines = [heading(score), ""];

  const nameWidth = Math.max("All values".length, widest(summary.documents.map((d) => d.document)));
  lines.push(tallyLine("All values", summary.all, nameWidth));
  for (const document of summary.documents) lines.push(tallyLine(document.document, document.tally, nameWidth));
  lines.push("");

  for (const document of summary.documents) {
    const width = Math.max("Value".length, widest(document.values.map((v) => v.label)));
    lines.push(`  ${document.document}`, `    ${"Value".padEnd(width)}  Correct`);
    for (const { label, tally } of document.values) {
      const mark = tally.correct < tally.total ? "  ←" : "";
      lines.push(`    ${label.padEnd(width)}  ${`${tally.correct}/${tally.total}`.padStart(7)}${mark}`);
    }
    lines.push("");
  }

  if (summary.failedReads.length > 0) {
    lines.push("  Failed reads (every value counted wrong):");
    for (const failed of summary.failedReads) {
      lines.push(`    ${failed.document} run ${failed.run}: ${failed.reason}`);
    }
    lines.push("");
  }

  if (summary.misses.length === 0) {
    lines.push(summary.failedReads.length === 0 ? "  Misses: none." : "  Misses in the other reads: none.");
  } else {
    lines.push("  Misses:");
    for (const miss of summary.misses) {
      lines.push(`    ${miss.document} run ${miss.run}  ${miss.label}: ${describeMiss(miss)}${caughtNote(miss)}`);
    }
  }
  lines.push("");

  const { checks } = summary;
  lines.push(
    checks.wrongValues === 0
      ? `  Checks: no wrong values to catch; ${count(checks.falseAlarms, "false alarm")}.`
      : `  Checks: ${count(checks.wrongValues, "wrong value")}; ${checks.caught} caught by a failed check, ` +
          `${checks.slippedThrough} passed every check, ${checks.notCheckable} in values no check uses; ` +
          `${count(checks.falseAlarms, "false alarm")}.`,
  );

  for (const spent of score.spent) {
    const tokensIn = Math.round(spent.usage.input_tokens / spent.reads).toLocaleString("en-US");
    const tokensOut = Math.round(spent.usage.output_tokens / spent.reads).toLocaleString("en-US");
    lines.push(
      `  ${spent.document}: ${dollars(readCostUsd(score.model, spent.usage) / spent.reads)} per read ` +
        `(about ${tokensIn} tokens in, ${tokensOut} out), ${(spent.seconds / spent.reads).toFixed(1)} s per read.`,
    );
  }
  lines.push(`  Cost: ${dollars(totalCost(score))} for these ${count(summary.reads, "read")}.`);
  return lines;
}

// ---------------------------------------------------------------------------
// The models side by side
// ---------------------------------------------------------------------------

export function formatDocumentComparison(scores: readonly DocumentModelScore[]): string[] {
  const documents = scores[0]?.summary.documents.map((d) => d.document) ?? [];
  const columns = ["Model", "All values", ...documents, "Failed reads", "$/set", "s/set"];
  const rows = scores.map((score) => [
    READ_MODELS[score.model].name,
    percent(score.summary.all),
    ...documents.map((name) => {
      const document = score.summary.documents.find((d) => d.document === name);
      return document ? percent(document.tally) : "n/a";
    }),
    String(score.summary.failedReads.length),
    dollars(costPerSet(score)),
    secondsPerSet(score).toFixed(1),
  ]);
  const widths = columns.map((column, i) => Math.max(column.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) =>
    `  ${cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ")}`;
  return [
    "Score per model",
    "",
    line(columns),
    ...rows.map(line),
    "",
    "  A set is one read of each document.",
  ];
}
