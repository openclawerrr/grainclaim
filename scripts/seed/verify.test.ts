import { describe, expect, it } from "vitest";
import { insuredRows, loadSampleFiles, policyRows } from "./sample-files";
import { valueProblems } from "./verify";

const files = loadSampleFiles();
const [northFile] = files.fields;
const [bin3File] = files.farm.bins;

/** Rows as the database returns them after a seed, with the columns it calculates. */
function loadedRows() {
  return {
    insured: insuredRows(files),
    field: files.fields.map((f) => ({ id: f.id, mapped_acres: f.properties.expected_acres })),
    bin: files.farm.bins.map((b) => ({ id: b.id, capacity_bu: b.expected_capacity_bu })),
    policy: policyRows(files),
  };
}

describe("valueProblems", () => {
  it("passes a correctly seeded farm, including the 2026 projected price", () => {
    expect(loadedRows().policy[0].projected_price).toBe(4.62);
    expect(valueProblems(loadedRows(), files)).toEqual([]);
  });

  it("accepts numeric columns returned as strings", () => {
    const rows = loadedRows();
    rows.policy[0] = { ...rows.policy[0], projected_price: "4.6200" as unknown as number };
    expect(valueProblems(rows, files)).toEqual([]);
  });

  it("catches a policy loaded without its projected price", () => {
    const rows = loadedRows();
    rows.policy[0] = { ...rows.policy[0], projected_price: null as unknown as number };
    expect(valueProblems(rows, files)).toEqual([
      "Policy SAMPLE-2026-CORN: database has projected price empty, sample-data says 4.62",
    ]);
  });

  it("catches acres and bin capacity the database calculates differently", () => {
    const rows = loadedRows();
    rows.field[0].mapped_acres = 80.19;
    rows.bin[0].capacity_bu = 19_000;
    expect(valueProblems(rows, files)).toEqual([
      `${northFile.properties.name}: database calculates 80.19 acres, sample-data says 80.2`,
      `${bin3File.name}: database calculates 19000 bu, sample-data says ${bin3File.expected_capacity_bu}`,
    ]);
  });
});
