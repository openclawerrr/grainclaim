import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scoreRead, summarize, type ScoredRead } from "../../lib/extract/score";
import type { TicketRead } from "../../lib/extract/ticket-schema";
import { checkTicket } from "../../lib/rules/ticket-checks";
import { loadDocumentsFile } from "../print/documents-file";
import { loadSampleFiles } from "../seed/sample-files";
import { parseArgs, USAGE } from "./args";
import { formatChecks, formatComparison, formatModelScore, formatValues, type ModelScore } from "./report";
import { matchPhotos, sampleHarvestWindow } from "./sample-tickets";

const documents = loadDocumentsFile();
const harvest = sampleHarvestWindow(loadSampleFiles().season);
const TICKET_PHOTOS = ["ticket-1.jpg", "ticket-2.jpg", "ticket-3.jpg", "ticket-4.jpg", "ticket-5.jpg", "ticket-6.jpg"];

describe("parseArgs", () => {
  it("score reads every photo once with both models by default", () => {
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

  it("read takes one photo and uses Sonnet unless told otherwise", () => {
    expect(parseArgs(["read", "a.jpg"])).toEqual({ kind: "read", photo: "a.jpg", model: "sonnet" });
    expect(parseArgs(["read", "--model=haiku", "a.jpg"])).toEqual({ kind: "read", photo: "a.jpg", model: "haiku" });
  });

  it("shows help", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["score", "--help"])).toEqual({ kind: "help" });
    expect(USAGE).toContain("npm run score-tickets");
  });

  it.each([
    [["read"], "Give one photo"],
    [["read", "a.jpg", "b.jpg"], "Give one photo"],
    [["read", "a.jpg", "--runs", "3"], 'Unknown option "--runs"'],
    [["score", "a.jpg"], "takes no file names"],
    [["score", "--model", "opus"], 'Unknown model "opus"'],
    [["score", "--model"], "--model needs a name"],
    [["score", "--runs", "0"], "--runs needs a whole number"],
    [["score", "--runs", "2.5"], "--runs needs a whole number"],
    [["score", "--runs"], "--runs needs a whole number"],
    [["score", "--json"], "--json needs a file name"],
    [["grade"], 'Unknown command "grade"'],
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("matchPhotos", () => {
  it("pairs the committed photos with the six tickets, in order, and skips the FSA-578 and the FSA map", () => {
    const match = matchPhotos(readdirSync(path.resolve("sample-data", "photos")), documents);
    expect(match.problems).toEqual([]);
    expect(match.tickets.map((t) => t.photo)).toEqual(TICKET_PHOTOS);
    expect(match.tickets.map((t) => t.filledIn)).toEqual(["printed", "printed", "by_hand", "printed", "printed", "printed"]);
    expect(match.tickets[2].expected).toBe(documents.documents["ticket-3"].values);
    // The FSA map's photo is added after its PDF is approved, so this holds with it and without it.
    expect(match.skipped).toContain("fsa-578.jpg");
    expect(match.skipped.filter((photo) => photo !== "fsa-578.jpg" && photo !== "fsa-map.jpg")).toEqual([]);
  });

  it("skips a photo of the FSA map, which has no reader yet, without reporting a problem", () => {
    expect(documents.documents["fsa-map"].kind).toBe("fsa_map");
    const match = matchPhotos([...TICKET_PHOTOS, "fsa-578.jpg", "fsa-map.jpg"], documents);
    expect(match.problems).toEqual([]);
    expect(match.skipped).toEqual(["fsa-578.jpg", "fsa-map.jpg"]);
    expect(match.tickets.map((t) => t.photo)).toEqual(TICKET_PHOTOS);
  });

  it("reports a ticket with no photo and a photo with no document", () => {
    const match = matchPhotos(["ticket-1.jpg", "ticket-9.jpg", "README.md"], documents);
    expect(match.problems).toEqual([
      'ticket-9.jpg has no document named "ticket-9" in documents-2026.json.',
      "ticket-2 has no photo. Expected sample-data/photos/ticket-2.jpg.",
      "ticket-3 has no photo. Expected sample-data/photos/ticket-3.jpg.",
      "ticket-4 has no photo. Expected sample-data/photos/ticket-4.jpg.",
      "ticket-5 has no photo. Expected sample-data/photos/ticket-5.jpg.",
      "ticket-6 has no photo. Expected sample-data/photos/ticket-6.jpg.",
    ]);
  });

  it("reports two photos of one ticket", () => {
    const match = matchPhotos([...TICKET_PHOTOS, "ticket-3.jpeg"], documents);
    expect(match.problems).toEqual(['"ticket-3" has more than one photo.']);
  });
});

describe("sampleHarvestWindow", () => {
  it("runs from the day planting finished through the end of the crop year", () => {
    expect(harvest).toEqual({ after: "2026-05-02", through: "2026-12-31" });
  });
});

describe("the report", () => {
  const key = documents.documents["ticket-3"].values as TicketRead;
  const read = (changes: Partial<TicketRead>, run: number): ScoredRead => {
    const values = { ...key, ...changes };
    return {
      ticket: "ticket-3",
      run,
      filledIn: "by_hand",
      failure: null,
      fields: scoreRead(values, key),
      checks: checkTicket(values, harvest),
    };
  };
  const failed: ScoredRead = {
    ticket: "ticket-3",
    run: 3,
    filledIn: "by_hand",
    failure: "The answer was cut off before it finished.",
    fields: scoreRead(null, key),
    checks: [],
  };
  const score: ModelScore = {
    model: "sonnet",
    effort: "medium",
    tickets: 1,
    runs: 3,
    summary: summarize([read({}, 1), read({ gross_lbs: 77_740, weigher: "KC", dockage_pct: 0, moisture_pct: null }, 2), failed]),
    usage: { input_tokens: 15_000, output_tokens: 3_000 },
    seconds: 21,
  };

  it("prints a score per value, the misses, what the checks caught, cost and time", () => {
    const text = formatModelScore(score).join("\n");
    expect(text).toContain("Claude Sonnet 5.5 (claude-sonnet-5-5), effort medium: 3 reads (1 ticket × 3 runs)");
    expect(text).toMatch(/All values\s+50\/81\s+61\.7%/);
    expect(text).toMatch(/gross_lbs\s+1\/3 {2}←/);
    expect(text).toMatch(/net_lbs\s+2\/3 {2}←/);
    expect(text).toContain("ticket-3 run 3: The answer was cut off before it finished.");
    expect(text).toContain("ticket-3 run 2  gross_lbs: read 77740, expected 79740  (caught by net_weight)");
    expect(text).toContain("ticket-3 run 2  moisture_pct: left blank, expected 17.9");
    expect(text).toContain("ticket-3 run 2  dockage_pct: read 0, expected (none)  (no check uses this value)");
    expect(text).toContain("Checks: 3 wrong values; 1 caught by a failed check, 0 passed every check, 2 in values no check uses; 0 false alarms.");
    expect(text).toContain("Cost: $0.0200 per ticket (about 5,000 tokens in, 1,000 out); $0.0600 for these 3 reads.");
    expect(text).toContain("Time: 7.0 s per ticket.");
  });

  it("says so when there is nothing to report", () => {
    const clean: ModelScore = { ...score, runs: 1, summary: summarize([read({}, 1)]) };
    const text = formatModelScore(clean).join("\n");
    expect(text).toContain("Misses: none.");
    expect(text).toContain("Checks: no wrong values to catch; 0 false alarms.");
  });

  it("puts the models side by side", () => {
    const haiku: ModelScore = { ...score, model: "haiku", summary: summarize([read({}, 1)]), seconds: 4 };
    const lines = formatComparison([score, haiku]);
    expect(lines[0]).toBe("Score per model");
    expect(lines[2]).toMatch(/Model\s+All values\s+Part 2\s+Printed\s+Handwritten\s+Failed reads\s+\$\/ticket\s+s\/ticket/);
    expect(lines[3]).toMatch(/Claude Sonnet 5\.5\s+61\.7%\s+60\.8%\s+n\/a\s+61\.7%\s+1\s+\$0\.0200\s+7\.0/);
    expect(lines[4]).toMatch(/Claude Haiku 5\.5\s+100\.0%\s+100\.0%\s+n\/a\s+100\.0%\s+0\s+\$0\.0030\s+4\.0/);
  });

  it("prints one read's values and checks", () => {
    expect(formatValues(key)).toContain("  dockage_pct           (none)");
    expect(formatValues(key)).toHaveLength(27);
    expect(formatChecks(checkTicket({ ...key, gross_lbs: 77_740, tare_lbs: null }, harvest))).toEqual([
      "  – Net weight can't be checked because tare weight wasn't read.",
      "  ✓ Net ÷ 56 lb = 985 bushels.",
      "  ✓ The date (2026-10-12) is inside this year's harvest.",
      "  ✓ 1.4% × 2.9 points over 15% = 4.06% shrink.",
      "  ✓ Bushels × (1 − 4.06% shrink) = 945.01 dry bushels.",
    ]);
  });
});
