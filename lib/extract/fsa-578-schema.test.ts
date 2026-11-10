import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import {
  fromFsa578Wire,
  fsa578ReadSchema,
  fsa578Values,
  fsa578WireSchema,
  type Fsa578Read,
  type Fsa578Wire,
} from "./fsa-578-schema";
import { validateFsa578 } from "./read-fsa-578";
import { sentValues } from "./wire-schema-testing";

const KEY = documentsOfKind(loadDocumentsFile(), "fsa_578")[0][1].values;

// The SAMPLE FSA-578 as Claude would return it from the photo.
const WIRE: Fsa578Wire = {
  program_year: 2026,
  farm_number: "1234",
  farmland_acres: 126.7,
  cropland_acres: 120.2,
  operator: { key: "1", name: "Dave's Farm (SAMPLE)", address: "SAMPLE: Rural Route 1, Nevada, IA" },
  other_producers: [{ key: "2", name: "Pat Landowner (SAMPLE)" }],
  fields: [
    {
      tract: "5678",
      field: "3",
      crop: "corn",
      crop_type: "YEL",
      intended_use: "GR",
      practice: "N",
      crop_status: "I",
      reported_acres: 80.2,
      planting_date: "2026-04-28",
      shares: [{ key: "1", share: 1 }],
    },
    {
      tract: "6012",
      field: "1",
      crop: "corn",
      crop_type: "YEL",
      intended_use: "GR",
      practice: "N",
      crop_status: "I",
      reported_acres: 40,
      planting_date: "2026-04-28",
      shares: [
        { key: "1", share: 0.6667 },
        { key: "2", share: 0.3333 },
      ],
    },
  ],
  total_operator_report: 120.2,
  certified_by: "Dave (SAMPLE)",
  certification_date: "2026-06-12",
};

describe("the FSA-578 schema", () => {
  it("accepts the answer key as it is", () => {
    expect(fsa578ReadSchema.parse(KEY)).toEqual(KEY);
  });

  it("has the answer key's values at every level, and both schemas agree", () => {
    const names = (shape: object) => Object.keys(shape).sort();
    expect(names(fsa578ReadSchema.shape)).toEqual(names(KEY));
    expect(names(fsa578WireSchema.shape)).toEqual(names(KEY));
    expect(names(fsa578ReadSchema.shape.fields.element.shape)).toEqual(names(KEY.fields[0]));
    expect(names(fsa578WireSchema.shape.fields.element.shape)).toEqual(names(KEY.fields[0]));
    expect(names(fsa578ReadSchema.shape.operator.shape)).toEqual(names(KEY.operator));
  });

  it("lets every value be null and every table be empty", () => {
    const blank: Fsa578Read = {
      program_year: null,
      farm_number: null,
      farmland_acres: null,
      cropland_acres: null,
      operator: { key: null, name: null, address: null },
      other_producers: [],
      fields: [],
      total_operator_report: null,
      certified_by: null,
      certification_date: null,
    };
    expect(fsa578ReadSchema.parse(blank)).toEqual(blank);
  });

  it("takes dates only as YYYY-MM-DD", () => {
    const read = validateFsa578({ ...fromFsa578Wire(WIRE), certification_date: "06-12-2026" });
    expect(read).toEqual({ ok: false, reason: expect.stringContaining("certification_date") });
    expect(read).toEqual({ ok: false, reason: expect.stringContaining("FSA-578 schema") });
  });
});

describe("what Claude fills in for an FSA-578", () => {
  it("stays inside structured outputs' limit of 16 values that can be null", () => {
    const nullable = sentValues(fsa578WireSchema).filter((v) => v.nullable);
    expect(nullable.map((v) => v.path)).toEqual([
      "program_year",
      "farmland_acres",
      "cropland_acres",
      "fields[].reported_acres",
      "fields[].planting_date",
      "fields[].shares[].share",
      "total_operator_report",
      "certification_date",
    ]);
  });

  it("describes every value for the model, nested ones included", () => {
    const values = sentValues(fsa578WireSchema);
    expect(values).toHaveLength(27);
    for (const value of values) expect(value.description, value.path).toBeTruthy();
  });

  it("becomes the answer key when everything is there", () => {
    expect(validateFsa578(fromFsa578Wire(WIRE))).toEqual({ ok: true, values: KEY });
  });

  it('turns "", unmarked codes and "other" into null, and keeps the rows', () => {
    const blank: Fsa578Wire = {
      ...WIRE,
      farm_number: " ",
      operator: { key: "1", name: "", address: "" },
      fields: [{ ...WIRE.fields[0], crop: "other", crop_type: "", practice: "unmarked", crop_status: "unmarked" }],
      certified_by: "",
    };
    const read = validateFsa578(fromFsa578Wire(blank));
    expect(read.ok && read.values).toMatchObject({
      farm_number: null,
      operator: { key: "1", name: null, address: null },
      fields: [{ tract: "5678", crop: null, crop_type: null, practice: null, crop_status: null, reported_acres: 80.2 }],
      certified_by: null,
    });
  });

  it("turns shares printed as percents into fractions", () => {
    const percents: Fsa578Wire = {
      ...WIRE,
      fields: [
        WIRE.fields[0],
        { ...WIRE.fields[1], shares: [{ key: "1", share: 66.67 }, { key: "2", share: 33.33 }] },
      ],
    };
    expect(validateFsa578(fromFsa578Wire(percents))).toEqual({ ok: true, values: KEY });
  });
});

describe("the FSA-578's values by name", () => {
  it("names all 36 values, rows by their farm, tract and field number and shares by producer key", () => {
    const values = fsa578Values(KEY);
    expect(values).toHaveLength(36);
    expect(new Set(values.map((v) => v.label)).size).toBe(36);
    expect(values.map((v) => v.label)).toEqual(
      expect.arrayContaining([
        "farm_number",
        "operator: name",
        "producer 2: name",
        "field 1234/5678/3: reported_acres",
        "field 1234/5678/3 share 1: share",
        "field 1234/6012/1 share 2: key",
        "certification_date",
      ]),
    );
    expect(values.find((v) => v.label === "field 1234/6012/1 share 2: share")!.value).toBe(0.3333);
  });

  it("marks names and the address as wording", () => {
    const wording = fsa578Values(KEY).filter((v) => v.wording).map((v) => v.label);
    expect(wording).toEqual(["operator: name", "operator: address", "producer 2: name", "certified_by"]);
  });

  it("gives a row the same names whatever order the rows are in", () => {
    const reversed = { ...KEY, fields: [...KEY.fields].reverse() };
    const byLabel = (form: Fsa578Read) => new Map(fsa578Values(form).map((v) => [v.label, v.value]));
    expect(byLabel(reversed)).toEqual(byLabel(KEY));
  });
});
