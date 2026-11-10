import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { checkFsa578 } from "../rules/fsa-578-checks";
import { fsa578Values, type Fsa578Read } from "./fsa-578-schema";
import { scoreValues, summarizeDocuments, type ScoredDocumentRead } from "./score-document";

const KEY: Fsa578Read = documentsOfKind(loadDocumentsFile(), "fsa_578")[0][1].values;
const EXPECTED = fsa578Values(KEY);

type Line = Fsa578Read["fields"][number];
/** The sample form with one field line changed: 0 is North 80, 1 is South 40. */
const withLine = (index: number, changes: Partial<Line>): Fsa578Read => ({
  ...KEY,
  fields: KEY.fields.map((line, i) => (i === index ? { ...line, ...changes } : line)),
});

/** A read of the sample FSA-578, scored and checked the way the script does. */
function scored(read: Fsa578Read, extra: Partial<ScoredDocumentRead> = {}): ScoredDocumentRead {
  return {
    document: "fsa-578",
    run: 1,
    failure: null,
    values: scoreValues(fsa578Values(read), EXPECTED),
    checks: checkFsa578(read),
    ...extra,
  };
}
const failedRead: ScoredDocumentRead = {
  document: "fsa-578",
  run: 2,
  failure: "The answer was cut off before it finished.",
  values: scoreValues(null, EXPECTED),
  checks: [],
};

describe("scoreValues", () => {
  it("scores the answer key against itself as all correct", () => {
    const scores = scoreValues(EXPECTED, EXPECTED);
    expect(scores).toHaveLength(36);
    expect(scores.every((s) => s.correct)).toBe(true);
  });

  it("matches rows by their numbers, whatever order they were read in", () => {
    const reversed = { ...KEY, fields: [...KEY.fields].reverse(), other_producers: [...KEY.other_producers].reverse() };
    const scores = scoreValues(fsa578Values(reversed), EXPECTED);
    expect(scores.map((s) => s.label)).toEqual(EXPECTED.map((v) => v.label));
    expect(scores.every((s) => s.correct)).toBe(true);
  });

  it("compares names ignoring case, spacing and punctuation, and everything else exactly", () => {
    const shouted = { ...KEY, operator: { ...KEY.operator, name: "DAVE'S FARM (SAMPLE)", address: "SAMPLE: RURAL ROUTE 1 NEVADA IA" } };
    expect(scoreValues(fsa578Values(shouted), EXPECTED).every((s) => s.correct)).toBe(true);

    const wrong = scoreValues(fsa578Values(withLine(0, { reported_acres: 80.02, crop_type: "yel" })), EXPECTED);
    expect(wrong.filter((s) => !s.correct)).toEqual([
      { label: "field 1234/5678/3: reported_acres", correct: false, read: 80.02, expected: 80.2 },
    ]);
  });

  it("scores a value read as null wrong, and a failed read wrong everywhere", () => {
    const blank = scoreValues(fsa578Values({ ...KEY, certified_by: null }), EXPECTED);
    expect(blank.filter((s) => !s.correct)).toEqual([
      { label: "certified_by", correct: false, read: null, expected: "Dave (SAMPLE)" },
    ]);
    const failed = scoreValues(null, EXPECTED);
    expect(failed).toHaveLength(36);
    expect(failed.every((s) => !s.correct && s.read === undefined)).toBe(true);
  });

  it("scores a row the read left out as wrong in every value", () => {
    const scores = scoreValues(fsa578Values({ ...KEY, fields: [KEY.fields[0]] }), EXPECTED);
    const missed = scores.filter((s) => !s.correct);
    expect(scores).toHaveLength(36);
    expect(missed).toHaveLength(13); // South 40's nine values and its two shares' four
    expect(missed.every((s) => s.label.startsWith("field 1234/6012/1") && s.read === undefined)).toBe(true);
  });

  it("scores a row the document doesn't have as extra values", () => {
    const third: Line = { ...KEY.fields[0], tract: "7000", field: "2", shares: [{ key: "1", share: 1 }] };
    const scores = scoreValues(fsa578Values({ ...KEY, fields: [...KEY.fields, third] }), EXPECTED);
    const extras = scores.slice(36);
    expect(extras).toHaveLength(11);
    expect(extras[0]).toEqual({ label: "field 1234/7000/2: tract", correct: false, read: "7000", expected: undefined });
    expect(scores.slice(0, 36).every((s) => s.correct)).toBe(true);
  });

  it("scores a row with a misread number as one missing row and one extra row", () => {
    const scores = scoreValues(fsa578Values(withLine(0, { tract: "5673" })), EXPECTED);
    expect(scores).toHaveLength(47);
    expect(scores.filter((s) => s.correct)).toHaveLength(25);
    expect(scores.filter((s) => s.read === undefined).map((s) => s.label)[0]).toBe("field 1234/5678/3: tract");
    expect(scores.filter((s) => s.expected === undefined).map((s) => s.label)[0]).toBe("field 1234/5673/3: tract");
  });
});

describe("summarizeDocuments", () => {
  it("adds up a perfect read", () => {
    const summary = summarizeDocuments([scored(KEY)]);
    expect(summary.all).toEqual({ correct: 36, total: 36 });
    expect(summary.documents).toHaveLength(1);
    expect(summary.documents[0].tally).toEqual({ correct: 36, total: 36 });
    expect(summary.documents[0].values).toHaveLength(36);
    expect(summary.misses).toEqual([]);
    expect(summary.failedReads).toEqual([]);
    expect(summary.checks).toEqual({ wrongValues: 0, caught: 0, slippedThrough: 0, notCheckable: 0, falseAlarms: 0 });
  });

  it("keeps a tally per value across runs and per document", () => {
    const coverage: ScoredDocumentRead = {
      document: "summary-of-coverage",
      run: 1,
      failure: null,
      values: [{ label: "policy_number", correct: true, read: "X", expected: "X" }],
      checks: [],
    };
    const summary = summarizeDocuments([scored(KEY), scored(withLine(0, { reported_acres: 60.2 }), { run: 2 }), coverage]);
    expect(summary.reads).toBe(3);
    expect(summary.all).toEqual({ correct: 72, total: 73 });
    expect(summary.documents.map((d) => [d.document, d.tally])).toEqual([
      ["fsa-578", { correct: 71, total: 72 }],
      ["summary-of-coverage", { correct: 1, total: 1 }],
    ]);
    const acres = summary.documents[0].values.find((v) => v.label === "field 1234/5678/3: reported_acres");
    expect(acres!.tally).toEqual({ correct: 1, total: 2 });
  });

  it("says which check caught a wrong value", () => {
    const summary = summarizeDocuments([scored(withLine(0, { reported_acres: 60.2 }))]);
    expect(summary.misses).toEqual([
      {
        document: "fsa-578",
        run: 1,
        label: "field 1234/5678/3: reported_acres",
        read: 60.2,
        expected: 80.2,
        kind: "wrong",
        checkable: true,
        caughtBy: ["acres_total"],
      },
    ]);
    expect(summary.checks).toEqual({ wrongValues: 1, caught: 1, slippedThrough: 0, notCheckable: 0, falseAlarms: 0 });
  });

  it("counts a wrong value every check passed, and one no check uses", () => {
    // Both acre values and the total are off together, so the sum still agrees.
    const agreeing = { ...withLine(0, { reported_acres: 80 }), total_operator_report: 120, certified_by: "Dove (SAMPLE)" };
    const summary = summarizeDocuments([scored(agreeing)]);
    expect(summary.misses.map((m) => [m.label, m.kind, m.checkable, m.caughtBy])).toEqual([
      ["field 1234/5678/3: reported_acres", "wrong", true, []],
      ["total_operator_report", "wrong", true, []],
      ["certified_by", "wrong", false, []],
    ]);
    expect(summary.checks).toEqual({ wrongValues: 3, caught: 0, slippedThrough: 2, notCheckable: 1, falseAlarms: 0 });
  });

  it("lists blank, missing and extra values, and counts only wrong and extra ones for the checks", () => {
    const read = {
      ...withLine(0, { tract: "5673", shares: [] }),
      certification_date: null,
    };
    const summary = summarizeDocuments([scored(read)]);
    const kinds = summary.misses.map((m) => m.kind);
    expect(kinds.filter((k) => k === "blank")).toHaveLength(1);
    expect(kinds.filter((k) => k === "missing")).toHaveLength(11);
    expect(kinds.filter((k) => k === "extra")).toHaveLength(9);
    expect(summary.checks.wrongValues).toBe(9);
  });

  it("counts a failed read in failedReads and not in the misses", () => {
    const summary = summarizeDocuments([scored(KEY), failedRead]);
    expect(summary.failedReads).toEqual([{ document: "fsa-578", run: 2, reason: "The answer was cut off before it finished." }]);
    expect(summary.all).toEqual({ correct: 36, total: 72 });
    expect(summary.misses).toEqual([]);
  });

  it("counts a failed check on values that were all read correctly as a false alarm", () => {
    const alarm = scored(KEY, {
      checks: [{ id: "acres_total", status: "fail", fields: ["total_operator_report"], message: "" }],
    });
    expect(summarizeDocuments([alarm]).checks.falseAlarms).toBe(1);
  });
});
