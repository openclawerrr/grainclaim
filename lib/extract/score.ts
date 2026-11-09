/**
 * Scores ticket reads against an answer key, one value at a time, and adds
 * the scores up. Pure: plain data in, results out.
 */
import {
  CHECKED_FIELDS,
  fieldsInFailedChecks,
  type CheckedField,
  type TicketCheck,
  type TicketCheckId,
} from "../rules/ticket-checks";
import {
  OTHER_PRINTED_FIELDS,
  PART_2_FIELDS,
  TICKET_FIELDS,
  type TicketField,
  type TicketRead,
} from "./ticket-schema";

export type TicketValue = string | number | boolean | null;
export type AnswerKey = Record<TicketField, TicketValue>;

export interface FieldScore {
  field: TicketField;
  correct: boolean;
  read: TicketValue;
  expected: TicketValue;
}

/** Names and addresses: handwriting changes their case, spacing and punctuation, not what they say. */
const WORDING_FIELDS: ReadonlySet<TicketField> = new Set(["buyer_name", "buyer_address", "customer", "grain"]);

const wording = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Whether a read value matches the answer key.
 * - Numbers, dates, times and boxes must match exactly.
 * - Names and addresses ignore case, spacing and punctuation.
 * - Other text (ticket, contract and truck numbers, the weigher) ignores case only.
 * - A value the ticket doesn't have must be read as null.
 */
export function valuesMatch(field: TicketField, read: TicketValue, expected: TicketValue): boolean {
  if (read === null || expected === null) return read === expected;
  if (typeof read === "number" && typeof expected === "number") return Math.abs(read - expected) < 1e-9;
  if (typeof read === "string" && typeof expected === "string") {
    if (WORDING_FIELDS.has(field)) return wording(read) === wording(expected);
    return read.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return read === expected;
}

/** One score per ticket value. A read that failed (null) scores every value wrong. */
export function scoreRead(read: TicketRead | null, expected: AnswerKey): FieldScore[] {
  return TICKET_FIELDS.map((field) => {
    const value = read ? read[field] : null;
    return {
      field,
      correct: read !== null && valuesMatch(field, value, expected[field]),
      read: value,
      expected: expected[field],
    };
  });
}

// ---------------------------------------------------------------------------
// Adding up
// ---------------------------------------------------------------------------

export interface ScoredRead {
  /** The document's name, such as "ticket-3". */
  ticket: string;
  /** 1 for the first read of this ticket, 2 for the second, and so on. */
  run: number;
  filledIn: "printed" | "by_hand";
  /** Why the read failed, or null if it returned values. */
  failure: string | null;
  fields: FieldScore[];
  /** The arithmetic checks run on the read values. Empty for a failed read. */
  checks: TicketCheck[];
}

export interface Tally {
  correct: number;
  total: number;
}

export interface Miss {
  ticket: string;
  run: number;
  field: TicketField;
  read: TicketValue;
  expected: TicketValue;
  /** "wrong": a value that isn't the ticket's. "blank": null where the ticket has a value. */
  kind: "wrong" | "blank";
  /** Whether any arithmetic check uses this value. */
  checkable: boolean;
  /** The failed checks that point at this value. */
  caughtBy: TicketCheckId[];
}

export interface ScoreSummary {
  reads: number;
  failedReads: { ticket: string; run: number; reason: string }[];
  all: Tally;
  part2: Tally;
  otherPrinted: Tally;
  printed: Tally;
  byHand: Tally;
  perField: Record<TicketField, Tally>;
  /** Misses in reads that returned values. A failed read is counted in failedReads instead. */
  misses: Miss[];
  checks: {
    /** Values read wrong (not blank) in reads that returned values. */
    wrongValues: number;
    /** Wrong values that a failed check points at. */
    caught: number;
    /** Wrong values a check uses, but every check passed. */
    slippedThrough: number;
    /** Wrong values no check uses, such as the truck number. */
    notCheckable: number;
    /** Failed checks whose values were all read correctly. */
    falseAlarms: number;
  };
}

const emptyTally = (): Tally => ({ correct: 0, total: 0 });

function add(tally: Tally, score: FieldScore): void {
  tally.total += 1;
  if (score.correct) tally.correct += 1;
}

export function summarize(reads: readonly ScoredRead[]): ScoreSummary {
  const part2: ReadonlySet<TicketField> = new Set(PART_2_FIELDS);
  const other: ReadonlySet<TicketField> = new Set(OTHER_PRINTED_FIELDS);
  const checkable: ReadonlySet<string> = new Set(CHECKED_FIELDS);

  const summary: ScoreSummary = {
    reads: reads.length,
    failedReads: [],
    all: emptyTally(),
    part2: emptyTally(),
    otherPrinted: emptyTally(),
    printed: emptyTally(),
    byHand: emptyTally(),
    perField: Object.fromEntries(TICKET_FIELDS.map((f) => [f, emptyTally()])) as Record<TicketField, Tally>,
    misses: [],
    checks: { wrongValues: 0, caught: 0, slippedThrough: 0, notCheckable: 0, falseAlarms: 0 },
  };

  for (const read of reads) {
    if (read.failure !== null) {
      summary.failedReads.push({ ticket: read.ticket, run: read.run, reason: read.failure });
    }
    const flagged = fieldsInFailedChecks(read.checks);
    const correctByField = new Map(read.fields.map((s) => [s.field as string, s.correct]));

    for (const score of read.fields) {
      add(summary.all, score);
      add(summary.perField[score.field], score);
      if (part2.has(score.field)) add(summary.part2, score);
      if (other.has(score.field)) add(summary.otherPrinted, score);
      add(read.filledIn === "by_hand" ? summary.byHand : summary.printed, score);

      if (score.correct || read.failure !== null) continue;
      const kind = score.read === null ? "blank" : "wrong";
      const isCheckable = checkable.has(score.field);
      const caughtBy = read.checks
        .filter((c) => c.status === "fail" && (c.fields as string[]).includes(score.field))
        .map((c) => c.id);
      summary.misses.push({
        ticket: read.ticket,
        run: read.run,
        field: score.field,
        read: score.read,
        expected: score.expected,
        kind,
        checkable: isCheckable,
        caughtBy,
      });
      if (kind === "wrong") {
        summary.checks.wrongValues += 1;
        if (flagged.has(score.field as CheckedField)) summary.checks.caught += 1;
        else if (isCheckable) summary.checks.slippedThrough += 1;
        else summary.checks.notCheckable += 1;
      }
    }

    summary.checks.falseAlarms += read.checks.filter(
      (c) => c.status === "fail" && c.fields.every((f) => correctByField.get(f) === true),
    ).length;
  }

  return summary;
}

export function percent({ correct, total }: Tally): string {
  if (total === 0) return "n/a";
  return `${((correct / total) * 100).toFixed(1)}%`;
}
