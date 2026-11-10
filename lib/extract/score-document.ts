/**
 * Scores a read of an FSA-578 or Summary of Coverage against its answer key,
 * one value at a time, and adds the scores up. Pure: plain data in, results out.
 *
 * Both sides are lists of named values (see lib/rules/document-checks.ts for
 * the names). A table row is named by the numbers that identify it, so a read
 * is compared row for row whatever order its rows come in. A row the read
 * left out scores every one of its values wrong; a row the document doesn't
 * have scores every one of its values as an extra.
 */
import { valuesInFailedChecks, type DocumentCheck } from "../rules/document-checks";
import { sameValue, type Tally } from "./score";

export type DocumentValue = string | number | boolean | null;

export interface NamedValue {
  /** Where the value sits on the document, such as "farm_number" or "unit 2: acres". */
  label: string;
  value: DocumentValue;
  /** A name or address: compared ignoring case, spacing and punctuation. */
  wording?: boolean;
}

export interface ValueScore {
  label: string;
  correct: boolean;
  /** Undefined when the read has no such value: its row is missing, or the read failed. */
  read: DocumentValue | undefined;
  /** Undefined when the document has no such value: the read has a row the document doesn't. */
  expected: DocumentValue | undefined;
}

/**
 * One score per value in the answer key, in its order, then one per extra
 * value in the read. A read that failed (null) scores every value wrong.
 */
export function scoreValues(read: readonly NamedValue[] | null, expected: readonly NamedValue[]): ValueScore[] {
  const readByLabel = new Map((read ?? []).map((v) => [v.label, v]));
  const expectedLabels = new Set(expected.map((v) => v.label));

  const scores: ValueScore[] = expected.map((want) => {
    const got = readByLabel.get(want.label);
    return {
      label: want.label,
      correct: got !== undefined && sameValue(got.value, want.value, want.wording === true),
      read: got?.value,
      expected: want.value,
    };
  });
  for (const got of read ?? []) {
    if (!expectedLabels.has(got.label)) {
      scores.push({ label: got.label, correct: false, read: got.value, expected: undefined });
    }
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Adding up
// ---------------------------------------------------------------------------

export interface ScoredDocumentRead {
  /** The document's name, such as "fsa-578". */
  document: string;
  /** 1 for the first read of this document, 2 for the second, and so on. */
  run: number;
  /** Why the read failed, or null if it returned values. */
  failure: string | null;
  values: ValueScore[];
  /** The checks run on the read values. Empty for a failed read. */
  checks: DocumentCheck[];
}

export interface DocumentMiss {
  document: string;
  run: number;
  label: string;
  read: DocumentValue | undefined;
  expected: DocumentValue | undefined;
  /**
   * "wrong": a value that isn't the document's. "blank": null where the
   * document has a value. "missing": the read has no such row. "extra": the
   * document has no such row.
   */
  kind: "wrong" | "blank" | "missing" | "extra";
  /** Whether any check uses this value. */
  checkable: boolean;
  /** The failed checks that point at this value. */
  caughtBy: string[];
}

export interface DocumentScoreSummary {
  reads: number;
  failedReads: { document: string; run: number; reason: string }[];
  all: Tally;
  /** One entry per document, in the order first read. */
  documents: {
    document: string;
    tally: Tally;
    /** One entry per value, in answer-key order, then any extras. */
    values: { label: string; tally: Tally }[];
  }[];
  /** Misses in reads that returned values. A failed read is counted in failedReads instead. */
  misses: DocumentMiss[];
  checks: {
    /** Values read wrong, or read in a row the document doesn't have, in reads that returned values. */
    wrongValues: number;
    /** Wrong values that a failed check points at. */
    caught: number;
    /** Wrong values a check uses, but every check passed. */
    slippedThrough: number;
    /** Wrong values no check uses, such as a name. */
    notCheckable: number;
    /** Failed checks whose values were all read correctly. */
    falseAlarms: number;
  };
}

function missKind(score: ValueScore): DocumentMiss["kind"] {
  if (score.expected === undefined) return "extra";
  if (score.read === undefined) return "missing";
  return score.read === null ? "blank" : "wrong";
}

export function summarizeDocuments(reads: readonly ScoredDocumentRead[]): DocumentScoreSummary {
  const summary: DocumentScoreSummary = {
    reads: reads.length,
    failedReads: [],
    all: { correct: 0, total: 0 },
    documents: [],
    misses: [],
    checks: { wrongValues: 0, caught: 0, slippedThrough: 0, notCheckable: 0, falseAlarms: 0 },
  };
  const count = (tally: Tally, score: ValueScore) => {
    tally.total += 1;
    if (score.correct) tally.correct += 1;
  };

  for (const read of reads) {
    if (read.failure !== null) {
      summary.failedReads.push({ document: read.document, run: read.run, reason: read.failure });
    }
    let document = summary.documents.find((d) => d.document === read.document);
    if (!document) {
      document = { document: read.document, tally: { correct: 0, total: 0 }, values: [] };
      summary.documents.push(document);
    }
    const flagged = valuesInFailedChecks(read.checks);
    const checkable = new Set(read.checks.flatMap((c) => c.fields));
    const correctByLabel = new Map(read.values.map((s) => [s.label, s.correct]));

    for (const score of read.values) {
      let value = document.values.find((v) => v.label === score.label);
      if (!value) {
        value = { label: score.label, tally: { correct: 0, total: 0 } };
        document.values.push(value);
      }
      count(summary.all, score);
      count(document.tally, score);
      count(value.tally, score);

      if (score.correct || read.failure !== null) continue;
      const kind = missKind(score);
      summary.misses.push({
        document: read.document,
        run: read.run,
        label: score.label,
        read: score.read,
        expected: score.expected,
        kind,
        checkable: checkable.has(score.label),
        caughtBy: read.checks.filter((c) => c.status === "fail" && c.fields.includes(score.label)).map((c) => c.id),
      });
      if (kind === "wrong" || kind === "extra") {
        summary.checks.wrongValues += 1;
        if (flagged.has(score.label)) summary.checks.caught += 1;
        else if (checkable.has(score.label)) summary.checks.slippedThrough += 1;
        else summary.checks.notCheckable += 1;
      }
    }

    summary.checks.falseAlarms += read.checks.filter(
      (c) => c.status === "fail" && c.fields.every((f) => correctByLabel.get(f) === true),
    ).length;
  }

  return summary;
}
