import { describe, expect, it } from "vitest";
import {
  keyPart,
  listOf,
  notChecked,
  round,
  uniqueRowLabels,
  usable,
  valueLabel,
  valuesInFailedChecks,
  yearOf,
  type DocumentCheck,
} from "./document-checks";

describe("naming a value", () => {
  it("names a value in a row by the row and the value", () => {
    expect(valueLabel("unit 2", "acres")).toBe("unit 2: acres");
  });

  it('shows a part that wasn\'t read as "?"', () => {
    expect(keyPart("5678")).toBe("5678");
    expect(keyPart(null)).toBe("?");
  });

  it("keeps two rows that read with the same numbers apart", () => {
    expect(uniqueRowLabels(["unit 1", "unit 2", "unit 2", "unit 2"])).toEqual([
      "unit 1",
      "unit 2",
      "unit 2 (2nd)",
      "unit 2 (3rd)",
    ]);
    expect(uniqueRowLabels(Array.from({ length: 12 }, () => "x")).slice(-2)).toEqual(["x (11th)", "x (12th)"]);
  });
});

describe("the arithmetic helpers", () => {
  it("rounds half up the way documents print", () => {
    expect(round(137.25, 1)).toBe(137.3);
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(3600.18, 0)).toBe(3600);
  });

  it("takes only numbers that could be on a document", () => {
    expect(usable(0)).toBe(true);
    expect(usable(null)).toBe(false);
    expect(usable(-1)).toBe(false);
    expect(usable(Number.NaN)).toBe(false);
  });

  it("gives the year of a real calendar date only", () => {
    expect(yearOf("2026-04-28")).toBe(2026);
    expect(yearOf("2026-02-30")).toBeNull();
    expect(yearOf("04-28-2026")).toBeNull();
  });

  it("lists names in a sentence", () => {
    expect(listOf(["acres"])).toBe("acres");
    expect(listOf(["acres", "share"])).toBe("acres and share");
    expect(listOf(["acres", "share", "yield"])).toBe("acres, share and yield");
  });
});

describe("check results", () => {
  it("says which values weren't read", () => {
    expect(notChecked("guarantee", ["a", "b"], ["a"], "unit 1's guarantee")).toEqual({
      id: "guarantee",
      status: "not_checked",
      fields: ["a", "b"],
      message: "Unit 1's guarantee can't be checked because a wasn't read.",
    });
    expect(notChecked("guarantee", ["a", "b"], ["a", "b"], "unit 1's guarantee").message).toBe(
      "Unit 1's guarantee can't be checked because a and b weren't read.",
    );
  });

  it("collects the values failed checks point at", () => {
    const checks: DocumentCheck[] = [
      { id: "one", status: "fail", fields: ["a", "b"], message: "" },
      { id: "two", status: "pass", fields: ["c"], message: "" },
      { id: "three", status: "not_checked", fields: ["d"], message: "" },
    ];
    expect([...valuesInFailedChecks(checks)]).toEqual(["a", "b"]);
  });
});
