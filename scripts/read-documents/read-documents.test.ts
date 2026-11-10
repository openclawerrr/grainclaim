import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fsa578Values, type Fsa578Read } from "../../lib/extract/fsa-578-schema";
import { scoreValues, summarizeDocuments, type ScoredDocumentRead } from "../../lib/extract/score-document";
import { checkFsa578 } from "../../lib/rules/fsa-578-checks";
import { documentsOfKind, loadDocumentsFile } from "../print/documents-file";
import { kindFromFileName, parseArgs, USAGE } from "./args";
import {
  costPerSet,
  formatChecks,
  formatDocumentComparison,
  formatDocumentScore,
  formatValues,
  secondsPerSet,
  type DocumentModelScore,
} from "./report";
import { matchDocuments } from "./sample-documents";

const documents = loadDocumentsFile();

describe("parseArgs", () => {
  it("score reads each document once with both models by default", () => {
    expect(parseArgs(["score"])).toEqual({ kind: "score", models: ["sonnet", "haiku"], runs: 1, jsonPath: null });
  });

  it("score takes one model, a number of runs and a file to save to", () => {
    expect(parseArgs(["score", "--model", "haiku", "--runs=3", "--json", "out.json"])).toEqual({
      kind: "score",
      models: ["haiku"],
      runs: 3,
      jsonPath: "out.json",
    });
  });

  it("read takes one file, tells its kind from its name and uses Haiku unless told otherwise", () => {
    expect(parseArgs(["read", "sample-data/photos/fsa-578.jpg"])).toEqual({
      kind: "read",
      file: "sample-data/photos/fsa-578.jpg",
      document: "fsa_578",
      model: "haiku",
    });
    expect(parseArgs(["read", "--model=sonnet", "summary-of-coverage.pdf"])).toMatchObject({
      document: "summary_of_coverage",
      model: "sonnet",
    });
  });

  it("read takes the kind from --kind when the name doesn't say, or says otherwise", () => {
    expect(parseArgs(["read", "IMG_0412.jpg", "--kind", "fsa-578"])).toMatchObject({ document: "fsa_578" });
    expect(parseArgs(["read", "fsa-578.jpg", "--kind=summary-of-coverage"])).toMatchObject({
      document: "summary_of_coverage",
    });
  });

  it("tells a document's kind from its file name", () => {
    expect(kindFromFileName("photos/FSA578 2026.jpeg")).toBe("fsa_578");
    expect(kindFromFileName("Summary of Coverage.pdf")).toBe("summary_of_coverage");
    expect(kindFromFileName("fsa-578/scan.jpg")).toBeNull();
    expect(kindFromFileName("ticket-3.jpg")).toBeNull();
  });

  it("shows help", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["read", "--help"])).toEqual({ kind: "help" });
    expect(USAGE).toContain("npm run score-documents");
    expect(USAGE).toContain("npm run read-document");
  });

  it.each([
    [["read"], "Give one file"],
    [["read", "a.jpg", "b.jpg"], "Give one file"],
    [["read", "IMG_0412.jpg"], 'Can\'t tell from its name what kind of document "IMG_0412.jpg" is'],
    [["read", "a.jpg", "--kind", "settlement"], 'Unknown kind "settlement"'],
    [["read", "a.jpg", "--kind"], "--kind needs a name"],
    [["read", "fsa-578.jpg", "--runs", "3"], 'Unknown option "--runs"'],
    [["score", "fsa-578.jpg"], "takes no file names"],
    [["score", "--kind", "fsa-578"], 'Unknown option "--kind"'],
    [["score", "--model", "opus"], 'Unknown model "opus"'],
    [["score", "--runs", "0"], "--runs needs a whole number"],
    [["score", "--json"], "--json needs a file name"],
    [["grade"], 'Unknown command "grade"'],
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("matchDocuments", () => {
  const photos = readdirSync(path.resolve("sample-data", "photos"));
  const prints = readdirSync(path.resolve("sample-data", "print"));

  it("pairs the FSA-578 with its photo and the Summary of Coverage with its PDF, and leaves the rest", () => {
    const match = matchDocuments(photos, prints, documents);
    expect(match.problems).toEqual([]);
    expect(match.documents.map((d) => [d.name, d.kind, d.file, d.expected.length])).toEqual([
      ["fsa-578", "fsa_578", "photos/fsa-578.jpg", 36],
      ["summary-of-coverage", "summary_of_coverage", "print/summary-of-coverage.pdf", 43],
    ]);
  });

  it("reports a document with no file, and one with two photos", () => {
    expect(matchDocuments(["ticket-1.jpg"], ["fsa-578.pdf"], documents).problems).toEqual([
      "fsa-578 has no photo. Expected sample-data/photos/fsa-578.jpg.",
      "summary-of-coverage has no PDF. Expected sample-data/print/summary-of-coverage.pdf.",
    ]);
    expect(matchDocuments(["fsa-578.jpg", "fsa-578.JPEG"], prints, documents).problems).toEqual([
      '"fsa-578" has more than one photo.',
    ]);
  });
});

describe("the report", () => {
  const key: Fsa578Read = documentsOfKind(documents, "fsa_578")[0][1].values;
  const expected = fsa578Values(key);
  const withNorth = (changes: Partial<Fsa578Read["fields"][number]>): Fsa578Read => ({
    ...key,
    fields: [{ ...key.fields[0], ...changes }, key.fields[1]],
  });
  const fsa = (read: Fsa578Read, run: number): ScoredDocumentRead => ({
    document: "fsa-578",
    run,
    failure: null,
    values: scoreValues(fsa578Values(read), expected),
    checks: checkFsa578(read),
  });
  const coverageKey = matchDocuments(["fsa-578.jpg"], ["summary-of-coverage.pdf"], documents).documents[1].expected;
  const coverage = (run: number, failure: string | null): ScoredDocumentRead => ({
    document: "summary-of-coverage",
    run,
    failure,
    values: scoreValues(failure ? null : coverageKey, coverageKey),
    checks: [],
  });

  const score: DocumentModelScore = {
    model: "sonnet",
    effort: "medium",
    runs: 2,
    summary: summarizeDocuments([
      fsa(key, 1),
      fsa({ ...withNorth({ reported_acres: 60.2 }), certified_by: null }, 2),
      coverage(1, null),
      coverage(2, "The answer was cut off before it finished."),
    ]),
    spent: [
      { document: "fsa-578", reads: 2, usage: { input_tokens: 17_000, output_tokens: 800 }, seconds: 10 },
      { document: "summary-of-coverage", reads: 2, usage: { input_tokens: 13_000, output_tokens: 1_000 }, seconds: 7 },
    ],
  };

  it("prints a score per document and per value, the misses, what the checks caught, cost and time", () => {
    const text = formatDocumentScore(score).join("\n");
    expect(text).toContain("Claude Sonnet 5.5 (claude-sonnet-5-5), effort medium: 4 reads (2 documents × 2 runs)");
    expect(text).toMatch(/All values\s+113\/158\s+71\.5%/);
    expect(text).toMatch(/fsa-578\s+70\/72\s+97\.2%/);
    expect(text).toMatch(/summary-of-coverage\s+43\/86\s+50\.0%/);
    expect(text).toMatch(/field 1234\/5678\/3: reported_acres\s+1\/2 {2}←/);
    expect(text).toMatch(/field 1234\/6012\/1 share 2: share\s+2\/2\n/);
    expect(text).toMatch(/unit 2: liability\s+1\/2 {2}←/);
    expect(text).toContain("summary-of-coverage run 2: The answer was cut off before it finished.");
    expect(text).toContain(
      "fsa-578 run 2  field 1234/5678/3: reported_acres: read 60.2, expected 80.2  (caught by acres_total)",
    );
    expect(text).toContain("fsa-578 run 2  certified_by: left blank, expected Dave (SAMPLE)");
    expect(text).toContain(
      "Checks: 1 wrong value; 1 caught by a failed check, 0 passed every check, 0 in values no check uses; 0 false alarms.",
    );
    expect(text).toContain("fsa-578: $0.0210 per read (about 8,500 tokens in, 400 out), 5.0 s per read.");
    expect(text).toContain("summary-of-coverage: $0.0180 per read (about 6,500 tokens in, 500 out), 3.5 s per read.");
    expect(text).toContain("Cost: $0.0780 for these 4 reads.");
  });

  it("says when a row is missing from the read and when the read has a row the document doesn't", () => {
    const misread: DocumentModelScore = { ...score, runs: 1, summary: summarizeDocuments([fsa(withNorth({ tract: "5673" }), 1)]) };
    const text = formatDocumentScore(misread).join("\n");
    expect(text).toContain("fsa-578 run 1  field 1234/5678/3: tract: not in the read, expected 5678");
    expect(text).toContain(
      "fsa-578 run 1  field 1234/5673/3: tract: read 5673, but the document has no such row  (no check uses this value)",
    );
    expect(text).toContain(
      "fsa-578 run 1  field 1234/5673/3: reported_acres: read 80.2, but the document has no such row  (every check passed)",
    );
    expect(text).toMatch(/field 1234\/5673\/3: tract\s+0\/1 {2}←/);
  });

  it("says so when there is nothing to report", () => {
    const clean: DocumentModelScore = { ...score, runs: 1, summary: summarizeDocuments([fsa(key, 1), coverage(1, null)]) };
    const text = formatDocumentScore(clean).join("\n");
    expect(text).toContain("Misses: none.");
    expect(text).toContain("Checks: no wrong values to catch; 0 false alarms.");
  });

  it("puts the models side by side, with what one read of each document costs", () => {
    const haiku: DocumentModelScore = {
      ...score,
      model: "haiku",
      summary: summarizeDocuments([fsa(key, 1), coverage(1, null)]),
      spent: [
        { document: "fsa-578", reads: 2, usage: { input_tokens: 20_000, output_tokens: 1_000 }, seconds: 10 },
        { document: "summary-of-coverage", reads: 2, usage: { input_tokens: 10_000, output_tokens: 1_000 }, seconds: 7 },
      ],
    };
    expect(costPerSet(score)).toBeCloseTo(0.039, 10);
    expect(secondsPerSet(score)).toBeCloseTo(8.5, 10);
    const lines = formatDocumentComparison([score, haiku]);
    expect(lines[0]).toBe("Score per model");
    expect(lines[2]).toMatch(/Model\s+All values\s+fsa-578\s+summary-of-coverage\s+Failed reads\s+\$\/set\s+s\/set/);
    expect(lines[3]).toMatch(/Claude Sonnet 5\.5\s+71\.5%\s+97\.2%\s+50\.0%\s+1\s+\$0\.0390\s+8\.5/);
    expect(lines[4]).toMatch(/Claude Haiku 5\.5\s+100\.0%\s+100\.0%\s+100\.0%\s+0\s+\$0\.0020\s+8\.5/);
    expect(lines.at(-1)).toBe("  A set is one read of each document.");
  });

  it("prints one read's values and checks", () => {
    const values = formatValues(fsa578Values({ ...key, certified_by: null }));
    expect(values).toHaveLength(36);
    expect(values).toContain("  farm_number                        1234");
    expect(values).toContain("  field 1234/6012/1 share 2: share   0.3333");
    expect(values).toContain("  certified_by                       (none)");
    expect(formatChecks(checkFsa578(withNorth({ reported_acres: 60.2, planting_date: null })))).toEqual([
      "  ✓ Field 1234/5678/3's shares add up to 1.",
      "  ✓ Field 1234/6012/1's shares add up to 1.",
      "  ✓ Every share belongs to a producer listed on the form.",
      "  ✗ The operator total reads 120.2 acres, but the fields' reported acres add up to 100.2.",
      "  ✓ Cropland (120.2 acres) fits inside farmland (126.7 acres).",
      "  ✓ Reported acres (120.2) fit inside farmland (126.7 acres).",
      "  – Field 1234/5678/3's planting date can't be checked because field 1234/5678/3: planting_date wasn't read.",
      "  ✓ Field 1234/6012/1 was planted 2026-04-28, in time for the 2026 program year.",
      "  ✓ The certification date (2026-06-12) fits the 2026 program year.",
    ]);
  });
});
