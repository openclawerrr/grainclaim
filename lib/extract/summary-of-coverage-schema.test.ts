import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { readSummaryOfCoverage, validateSummaryOfCoverage } from "./read-summary-of-coverage";
import {
  fromSummaryOfCoverageWire,
  summaryOfCoverageReadSchema,
  summaryOfCoverageValues,
  summaryOfCoverageWireSchema,
  type SummaryOfCoverageRead,
  type SummaryOfCoverageWire,
} from "./summary-of-coverage-schema";
import { describeKindCheck, sentValues } from "./wire-schema-testing";

const KEY = documentsOfKind(loadDocumentsFile(), "summary_of_coverage")[0][1].values;
/** The answer key as a read: the same values, with the practice held to the app's choices. */
const READ: SummaryOfCoverageRead = summaryOfCoverageReadSchema.parse(KEY);

const unit = (changes: Partial<SummaryOfCoverageWire["units"][number]>): SummaryOfCoverageWire["units"][number] => ({
  unit_number: "1",
  unit_type: "basic",
  practice: "non-irrigated",
  fsa_farm: "1234",
  fsa_tract: "5678",
  fsa_field: "3",
  acres: 80,
  insured_share: 1,
  approved_yield: 180,
  guarantee_bu_per_acre: 135,
  guarantee_bu: 10_800,
  liability: 49_896,
  ...changes,
});

// The SAMPLE Summary of Coverage as Claude would return it from the PDF.
const WIRE: SummaryOfCoverageWire = {
  insurer: "Sample Mutual Crop Insurance",
  agency: "Main Street Insurance Agency (SAMPLE)",
  issued_date: "2026-07-20",
  insured_name: "Dave's Farm (SAMPLE)",
  insured_address: "SAMPLE: Rural Route 1, Nevada, IA",
  policy_number: "SAMPLE-2026-CORN",
  crop_year: 2026,
  crop: "corn",
  crop_type: "Grain",
  state: "IA",
  county: "Story",
  plan: "RP",
  coverage_level_pct: 75,
  price_election_pct: 100,
  unit_structure: "basic",
  projected_price: 4.62,
  units: [
    unit({}),
    unit({ unit_number: "2", fsa_tract: "6012", fsa_field: "1", acres: 40, insured_share: 0.6667, guarantee_bu: 3_600, liability: 16_633 }),
  ],
  total_acres: 120,
  total_guarantee_bu: 14_400,
  total_liability: 66_529,
};

describe("the Summary of Coverage schema", () => {
  it("accepts the answer key as it is", () => {
    expect(summaryOfCoverageReadSchema.parse(KEY)).toEqual(KEY);
  });

  it("has the answer key's values at every level", () => {
    const names = (shape: object) => Object.keys(shape).sort();
    expect(names(summaryOfCoverageReadSchema.shape)).toEqual(names(KEY));
    expect(names(summaryOfCoverageReadSchema.shape.units.element.shape)).toEqual(names(KEY.units[0]));
    expect(names(summaryOfCoverageWireSchema.shape.units.element.shape)).toEqual(names(KEY.units[0]));
  });

  it("asks Claude for the same values, with the two percents as printed", () => {
    const asked = Object.keys(summaryOfCoverageWireSchema.shape)
      .map((name) => name.replace(/_pct$/, ""))
      .sort();
    expect(asked).toEqual(Object.keys(KEY).sort());
  });

  it("lets every value be null and the table be empty", () => {
    const blank = Object.fromEntries(
      Object.keys(summaryOfCoverageReadSchema.shape).map((name) => [name, name === "units" ? [] : null]),
    );
    expect(summaryOfCoverageReadSchema.parse(blank)).toEqual(blank);
  });

  it("takes the state only as two capital letters", () => {
    const read = validateSummaryOfCoverage({ ...fromSummaryOfCoverageWire(WIRE), state: "Iowa" });
    expect(read).toEqual({ ok: false, reason: expect.stringContaining("state") });
    expect(read).toEqual({ ok: false, reason: expect.stringContaining("Summary of Coverage schema") });
  });
});

describe("what Claude fills in for a Summary of Coverage", () => {
  it("stays inside structured outputs' limit of 16 values that can be null", () => {
    const nullable = sentValues(summaryOfCoverageWireSchema).filter((v) => v.nullable);
    expect(nullable.map((v) => v.path)).toEqual([
      "issued_date",
      "crop_year",
      "coverage_level_pct",
      "price_election_pct",
      "projected_price",
      "units[].acres",
      "units[].insured_share",
      "units[].approved_yield",
      "units[].guarantee_bu_per_acre",
      "units[].guarantee_bu",
      "units[].liability",
      "total_acres",
      "total_guarantee_bu",
      "total_liability",
    ]);
  });

  it("describes every value for the model, nested ones included", () => {
    const values = sentValues(summaryOfCoverageWireSchema);
    expect(values).toHaveLength(32);
    for (const value of values) expect(value.description, value.path).toBeTruthy();
  });

  it("becomes the answer key when everything is there, with percents as fractions", () => {
    expect(validateSummaryOfCoverage(fromSummaryOfCoverageWire(WIRE))).toEqual({ ok: true, values: KEY });
  });

  it('turns "" and "other" into null', () => {
    const blank: SummaryOfCoverageWire = {
      ...WIRE,
      agency: "",
      crop: "other",
      state: "",
      plan: "other",
      coverage_level_pct: null,
      unit_structure: "other",
      units: [unit({ unit_type: "other", practice: "other", fsa_farm: "", fsa_tract: " ", fsa_field: "" })],
    };
    const read = validateSummaryOfCoverage(fromSummaryOfCoverageWire(blank));
    expect(read.ok && read.values).toMatchObject({
      agency: null,
      crop: null,
      state: null,
      plan: null,
      coverage_level: null,
      price_election: 1,
      unit_structure: null,
      units: [{ unit_number: "1", unit_type: null, practice: null, fsa_farm: null, fsa_tract: null, fsa_field: null }],
    });
  });

  it("capitalizes the state and takes a share printed as a percent", () => {
    const wire: SummaryOfCoverageWire = { ...WIRE, state: "ia", units: [WIRE.units[0], { ...WIRE.units[1], insured_share: 66.67 }] };
    expect(validateSummaryOfCoverage(fromSummaryOfCoverageWire(wire))).toEqual({ ok: true, values: KEY });
  });
});

describe("the Summary of Coverage's values by name", () => {
  it("names all 43 values, units by their unit number", () => {
    const values = summaryOfCoverageValues(READ);
    expect(values).toHaveLength(43);
    expect(new Set(values.map((v) => v.label)).size).toBe(43);
    expect(values.map((v) => v.label)).toEqual(
      expect.arrayContaining(["policy_number", "coverage_level", "unit 1: acres", "unit 2: liability", "total_liability"]),
    );
    expect(values.find((v) => v.label === "unit 2: insured_share")!.value).toBe(0.6667);
  });

  it("marks names and the address as wording", () => {
    const wording = summaryOfCoverageValues(READ).filter((v) => v.wording).map((v) => v.label);
    expect(wording).toEqual(["insurer", "agency", "insured_name", "insured_address", "county"]);
  });

  it("gives a unit the same names whatever order the rows are in", () => {
    const reversed = { ...READ, units: [...READ.units].reverse() };
    const byLabel = (summary: SummaryOfCoverageRead) =>
      new Map(summaryOfCoverageValues(summary).map((v) => [v.label, v.value]));
    expect(byLabel(reversed)).toEqual(byLabel(READ));
  });
});

describeKindCheck({
  name: "readSummaryOfCoverage",
  expects: "summary_of_coverage",
  read: readSummaryOfCoverage,
  wire: WIRE,
  values: KEY,
});
