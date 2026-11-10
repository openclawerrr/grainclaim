import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import {
  checkSummaryOfCoverage,
  coverageUnitLabels,
  type SummaryOfCoverageCheckInput,
} from "./summary-of-coverage-checks";

// The SAMPLE Summary of Coverage as printed in the answer key.
const SUMMARY: SummaryOfCoverageCheckInput = documentsOfKind(loadDocumentsFile(), "summary_of_coverage")[0][1].values;

type Unit = SummaryOfCoverageCheckInput["units"][number];
/** The sample summary with one unit changed: 0 is Unit 1, 1 is Unit 2. */
const withUnit = (index: number, changes: Partial<Unit>): SummaryOfCoverageCheckInput => ({
  ...SUMMARY,
  units: SUMMARY.units.map((unit, i) => (i === index ? { ...unit, ...changes } : unit)),
});
const failed = (summary: SummaryOfCoverageCheckInput) =>
  checkSummaryOfCoverage(summary)
    .filter((c) => c.status === "fail")
    .map((c) => [c.id, c.message]);
const check = (summary: SummaryOfCoverageCheckInput, id: string, nth = 0) =>
  checkSummaryOfCoverage(summary).filter((c) => c.id === id)[nth];

describe("naming the rows", () => {
  it("names a unit by its unit number", () => {
    expect(coverageUnitLabels(SUMMARY.units)).toEqual(["unit 1", "unit 2"]);
    expect(coverageUnitLabels([{ unit_number: null }, { unit_number: "0001-0001BU" }])).toEqual([
      "unit ?",
      "unit 0001-0001BU",
    ]);
  });
});

describe("the sample Summary of Coverage", () => {
  it("passes every check", () => {
    expect(checkSummaryOfCoverage(SUMMARY).map((c) => [c.status, c.message])).toEqual([
      ["pass", "Unit 1: 180 bu × 75% = 135 bu per acre."],
      ["pass", "Unit 1: approved yield × coverage level × acres × share = 10,800 bu."],
      ["pass", "Unit 1: guarantee × $4.62 × 100% price election = $49,896."],
      ["pass", "Unit 2: 180 bu × 75% = 135 bu per acre."],
      ["pass", "Unit 2: approved yield × coverage level × acres × share = 3,600 bu."],
      ["pass", "Unit 2: guarantee × $4.62 × 100% price election = $16,633."],
      ["pass", "The units add up to the total acres (120 acres)."],
      ["pass", "The units add up to the total guarantee (14,400 bu)."],
      ["pass", "The units add up to the total liability ($66,529)."],
      ["pass", "The issue date (2026-07-20) fits the 2026 crop year."],
    ]);
  });
});

describe("guarantee per acre", () => {
  it("catches a misread yield and points at the three values", () => {
    const misread = check(withUnit(0, { approved_yield: 130 }), "guarantee_per_acre");
    expect(misread).toEqual({
      id: "guarantee_per_acre",
      status: "fail",
      fields: ["unit 1: approved_yield", "coverage_level", "unit 1: guarantee_bu_per_acre"],
      message: "Unit 1's guarantee per acre reads 135, but approved yield × coverage level is 97.5.",
    });
  });

  it("matches at whatever precision the document prints", () => {
    // 183 × 75% = 137.25
    for (const printed of [137, 137.3, 137.25]) {
      expect(check(withUnit(0, { approved_yield: 183, guarantee_bu_per_acre: printed }), "guarantee_per_acre").status).toBe("pass");
    }
    expect(check(withUnit(0, { approved_yield: 183, guarantee_bu_per_acre: 137.2 }), "guarantee_per_acre").status).toBe("fail");
  });

  it("isn't checked when a value is unread", () => {
    expect(check({ ...SUMMARY, coverage_level: null }, "guarantee_per_acre").message).toBe(
      "Unit 1's guarantee per acre can't be checked because coverage_level wasn't read.",
    );
  });
});

describe("guarantee", () => {
  it("catches misread acres", () => {
    expect(failed(withUnit(0, { acres: 60 }))).toEqual([
      ["guarantee", "Unit 1's guarantee reads 10,800 bu, but approved yield × coverage level × acres × share is 8,100."],
      ["total_acres", "The total acres reads 120 acres, but the units add up to 100 acres."],
    ]);
  });

  it("catches a misread share on the crop-share unit", () => {
    const misread = check(withUnit(1, { insured_share: 0.6067 }), "guarantee", 1);
    expect(misread.status).toBe("fail");
    expect(misread.fields).toEqual([
      "unit 2: approved_yield",
      "coverage_level",
      "unit 2: acres",
      "unit 2: insured_share",
      "unit 2: guarantee_bu",
    ]);
  });

  it("fails with the reason when the values can't describe a guarantee", () => {
    expect(check({ ...SUMMARY, coverage_level: 7.5 }, "guarantee").message).toBe(
      "Unit 1's guarantee can't be worked out: Coverage level must be a fraction from 0 to 1 (0.75 for 75%), got 7.5.",
    );
  });

  it("isn't checked when a value is unread", () => {
    expect(check(withUnit(1, { acres: null, guarantee_bu: null }), "guarantee", 1).message).toBe(
      "Unit 2's guarantee can't be checked because unit 2: acres and unit 2: guarantee_bu weren't read.",
    );
  });
});

describe("liability", () => {
  it("catches a misread liability, in the unit and in the total", () => {
    expect(failed(withUnit(0, { liability: 49_396 }))).toEqual([
      ["liability", "Unit 1's liability reads $49,396, but guarantee × projected price × price election is $49,896."],
      ["total_liability", "The total liability reads $66,529, but the units add up to $66,029."],
    ]);
  });

  it("takes liability worked out from the printed guarantee or the unrounded one", () => {
    // Unit 2: 3,600 bu printed × $4.62 = $16,632; 3,600.18 bu unrounded × $4.62 = $16,633.
    const liabilityOf = (liability: number) => check(withUnit(1, { liability }), "liability", 1).status;
    expect(liabilityOf(16_632)).toBe("pass");
    expect(liabilityOf(16_633)).toBe("pass");
    expect(liabilityOf(16_634)).toBe("fail");
  });

  it("catches a misread projected price in every unit", () => {
    expect(failed({ ...SUMMARY, projected_price: 4.82 }).map(([id]) => id)).toEqual(["liability", "liability"]);
  });

  it("isn't checked when a value is unread", () => {
    expect(check({ ...SUMMARY, price_election: null }, "liability").status).toBe("not_checked");
  });
});

describe("totals and the issue date", () => {
  it("catches each misread total", () => {
    expect(failed({ ...SUMMARY, total_acres: 126 })).toEqual([
      ["total_acres", "The total acres reads 126 acres, but the units add up to 120 acres."],
    ]);
    expect(failed({ ...SUMMARY, total_guarantee_bu: 14_100 })).toEqual([
      ["total_guarantee", "The total guarantee reads 14,100 bu, but the units add up to 14,400 bu."],
    ]);
    expect(check(SUMMARY, "total_liability").fields).toEqual(["unit 1: liability", "unit 2: liability", "total_liability"]);
  });

  it("isn't checked without units or with a value unread", () => {
    const none = checkSummaryOfCoverage({ ...SUMMARY, units: [] });
    expect(none.map((c) => [c.id, c.status])).toEqual([
      ["total_acres", "not_checked"],
      ["total_guarantee", "not_checked"],
      ["total_liability", "not_checked"],
      ["issued_date", "pass"],
    ]);
    expect(none[0].message).toBe("The total acres can't be checked because no units were read.");
    expect(check({ ...SUMMARY, total_acres: null }, "total_acres").status).toBe("not_checked");
  });

  it("takes an issue date in the crop year or the year before", () => {
    const issued = (issued_date: string | null) => check({ ...SUMMARY, issued_date }, "issued_date");
    expect(issued("2025-11-03").status).toBe("pass");
    expect(issued("2024-07-20").message).toBe("The issue date reads 2024-07-20, which doesn't fit the 2026 crop year.");
    expect(issued("2026-13-01").message).toBe('The issue date reads "2026-13-01", which isn\'t a calendar date.');
    expect(issued(null).status).toBe("not_checked");
  });
});
