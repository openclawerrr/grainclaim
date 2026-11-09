/** Turns reads and scores into the text the commands print. Pure. */
import { READ_MODELS, readCostUsd, type ReadModelKey, type ReadUsage } from "../../lib/extract/models";
import { percent, type ScoreSummary, type Tally, type TicketValue } from "../../lib/extract/score";
import { TICKET_FIELDS, type TicketRead } from "../../lib/extract/ticket-schema";
import type { TicketCheck } from "../../lib/rules/ticket-checks";

const CHECK_MARKS: Record<TicketCheck["status"], string> = { pass: "✓", fail: "✗", not_checked: "–" };

const show = (value: TicketValue) => (value === null ? "(none)" : String(value));
const dollars = (usd: number) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatValues(values: TicketRead): string[] {
  const width = Math.max(...TICKET_FIELDS.map((f) => f.length));
  return TICKET_FIELDS.map((field) => `  ${field.padEnd(width)}  ${show(values[field])}`);
}

export function formatChecks(checks: readonly TicketCheck[]): string[] {
  return checks.map((check) => `  ${CHECK_MARKS[check.status]} ${check.message}`);
}

// ---------------------------------------------------------------------------
// One model's score
// ---------------------------------------------------------------------------

export interface ModelScore {
  model: ReadModelKey;
  effort: string;
  tickets: number;
  runs: number;
  summary: ScoreSummary;
  /** Tokens billed across every read. */
  usage: ReadUsage;
  /** Seconds across every read, added up (reads overlap, so this is not the wall-clock time). */
  seconds: number;
}

export function costPerTicket(score: ModelScore): number {
  return readCostUsd(score.model, score.usage) / score.summary.reads;
}

export function secondsPerTicket(score: ModelScore): number {
  return score.seconds / score.summary.reads;
}

function tallyLine(label: string, tally: Tally): string {
  return `  ${label.padEnd(18)} ${`${tally.correct}/${tally.total}`.padStart(9)}  ${percent(tally).padStart(6)}`;
}

function heading(score: ModelScore): string {
  const model = READ_MODELS[score.model];
  const reads = `${count(score.summary.reads, "read")} (${count(score.tickets, "ticket")} × ${count(score.runs, "run")})`;
  return `${model.name} (${model.id}), effort ${score.effort}: ${reads}`;
}

export function formatModelScore(score: ModelScore): string[] {
  const { summary } = score;
  const lines = [heading(score), ""];

  lines.push(
    tallyLine("All values", summary.all),
    tallyLine("Part 2 values", summary.part2),
    tallyLine("Other printed", summary.otherPrinted),
    tallyLine("Printed tickets", summary.printed),
    tallyLine("Handwritten", summary.byHand),
    "",
  );

  const width = Math.max(...TICKET_FIELDS.map((f) => f.length));
  lines.push(`  ${"Value".padEnd(width)}  Correct`);
  for (const field of TICKET_FIELDS) {
    const tally = summary.perField[field];
    const mark = tally.correct < tally.total ? "  ←" : "";
    lines.push(`  ${field.padEnd(width)}  ${`${tally.correct}/${tally.total}`.padStart(7)}${mark}`);
  }
  lines.push("");

  if (summary.failedReads.length > 0) {
    lines.push("  Failed reads (every value counted wrong):");
    for (const failed of summary.failedReads) {
      lines.push(`    ${failed.ticket} run ${failed.run}: ${failed.reason}`);
    }
    lines.push("");
  }

  if (summary.misses.length === 0) {
    lines.push(summary.failedReads.length === 0 ? "  Misses: none." : "  Misses in the other reads: none.");
  } else {
    lines.push("  Misses:");
    for (const miss of summary.misses) {
      const what =
        miss.kind === "blank"
          ? `left blank, expected ${show(miss.expected)}`
          : `read ${show(miss.read)}, expected ${show(miss.expected)}`;
      const caught =
        miss.kind === "blank"
          ? ""
          : miss.caughtBy.length > 0
            ? `  (caught by ${miss.caughtBy.join(", ")})`
            : miss.checkable
              ? "  (every check passed)"
              : "  (no check uses this value)";
      lines.push(`    ${miss.ticket} run ${miss.run}  ${miss.field}: ${what}${caught}`);
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

  const reads = summary.reads;
  const tokensIn = Math.round(score.usage.input_tokens / reads).toLocaleString("en-US");
  const tokensOut = Math.round(score.usage.output_tokens / reads).toLocaleString("en-US");
  lines.push(
    `  Cost: ${dollars(costPerTicket(score))} per ticket (about ${tokensIn} tokens in, ${tokensOut} out); ` +
      `${dollars(readCostUsd(score.model, score.usage))} for these ${count(reads, "read")}.`,
    `  Time: ${secondsPerTicket(score).toFixed(1)} s per ticket.`,
  );
  return lines;
}

// ---------------------------------------------------------------------------
// The models side by side
// ---------------------------------------------------------------------------

export function formatComparison(scores: readonly ModelScore[]): string[] {
  const columns = ["Model", "All values", "Part 2", "Printed", "Handwritten", "Failed reads", "$/ticket", "s/ticket"];
  const rows = scores.map((score) => [
    READ_MODELS[score.model].name,
    percent(score.summary.all),
    percent(score.summary.part2),
    percent(score.summary.printed),
    percent(score.summary.byHand),
    String(score.summary.failedReads.length),
    dollars(costPerTicket(score)),
    secondsPerTicket(score).toFixed(1),
  ]);
  const widths = columns.map((column, i) => Math.max(column.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) =>
    `  ${cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ")}`;
  return ["Score per model", "", line(columns), ...rows.map(line)];
}
