import { describe, expect, it } from "vitest";
import { loadSampleFiles } from "../../scripts/seed/sample-files";
import { outlineCenter } from "../map/geometry";
import {
  defaultFieldNames,
  fieldNameProblem,
  MAX_FIELD_NAME_LENGTH,
  sameFieldName,
  sizeWord,
  tidyFieldName,
  type NameableField,
} from "./field-names";

const sample = loadSampleFiles();

/** A field so many meters east and north of a spot near Dave's farm. */
const field = (eastMeters: number, northMeters: number, acres: number, fsaField = "1", fsaTract = "5678"): NameableField => ({
  center: [-93.42 + eastMeters / 82_600, 42.09 + northMeters / 111_320],
  acres,
  fsaTract,
  fsaField,
});

describe("sizeWord", () => {
  it("says a field's size the way farmers do", () => {
    expect(sizeWord(80.2)).toBe("80");
    expect(sizeWord(40)).toBe("40");
    expect(sizeWord(156.3)).toBe("160");
    expect(sizeWord(77.4)).toBe("80");
    expect(sizeWord(34.9)).toBe("30");
    expect(sizeWord(35)).toBe("40");
  });

  it("rounds a small field to the nearest 5, and a patch to the acre", () => {
    expect(sizeWord(22)).toBe("20");
    expect(sizeWord(12.4)).toBe("10");
    expect(sizeWord(3.2)).toBe("3");
    expect(sizeWord(0.3)).toBe("1");
  });

  it("has no word for acres that aren't a size", () => {
    expect(sizeWord(0)).toBe("");
    expect(sizeWord(Number.NaN)).toBe("");
  });
});

describe("defaultFieldNames", () => {
  it("names Dave's sample fields North 80 and South 40", () => {
    const fields = sample.fields.map((f) => ({
      center: outlineCenter(f.geometry.coordinates[0]),
      acres: f.properties.expected_acres,
      fsaTract: f.properties.fsa_tract,
      fsaField: f.properties.fsa_field,
    }));
    expect(defaultFieldNames(fields)).toEqual(["North 80", "South 40"]);
    expect(defaultFieldNames([...fields].reverse())).toEqual(["South 40", "North 80"]);
  });

  it("names fields by where they lie among the fields being named", () => {
    expect(defaultFieldNames([field(-800, 0, 160), field(800, 0, 80)])).toEqual(["West 160", "East 80"]);
    expect(defaultFieldNames([field(0, 600, 40), field(0, -600, 40)])).toEqual(["North 40", "South 40"]);
  });

  it("goes by the longer way a field lies off the middle", () => {
    // North-east of the middle, but much more north than east.
    expect(defaultFieldNames([field(100, 600, 80), field(-100, -600, 40)])).toEqual(["North 80", "South 40"]);
  });

  it("tells two fields on the same side and of the same size apart by a finer direction", () => {
    const names = defaultFieldNames([field(-500, 700, 80), field(500, 700, 80), field(0, -1400, 160)]);
    expect(names).toEqual(["Northwest 80", "Northeast 80", "South 160"]);
  });

  it("falls back to the FSA field number when a direction can't tell two fields apart", () => {
    const names = defaultFieldNames([field(0, 700, 80, "3"), field(40, 760, 80, "4"), field(0, -1460, 160, "1")]);
    expect(names).toEqual(["Field 3", "Field 4", "South 160"]);
  });

  it("falls back to the tract and field number when field numbers repeat across tracts", () => {
    const names = defaultFieldNames([field(0, 700, 80, "1", "5678"), field(40, 760, 80, "1", "6012"), field(0, -1460, 160, "2")]);
    expect(names).toEqual(["Tract 5678 field 1", "Tract 6012 field 1", "South 160"]);
  });

  it("names a field on its own by its FSA field number: it lies north of nothing", () => {
    expect(defaultFieldNames([field(0, 0, 80.2, "3")])).toEqual(["Field 3"]);
  });

  it("doesn't offer a name the farm already uses", () => {
    expect(defaultFieldNames([field(0, 600, 80, "3"), field(0, -600, 40, "1")], ["north 80"])).toEqual(["Field 3", "South 40"]);
  });

  it("names nothing when there is nothing to name", () => {
    expect(defaultFieldNames([])).toEqual([]);
  });
});

describe("a name the farmer gives", () => {
  it("is tidied and compared the way people compare names", () => {
    expect(tidyFieldName("  North   80 ")).toBe("North 80");
    expect(sameFieldName("North 80", " north  80")).toBe(true);
    expect(sameFieldName("North 80", "North 40")).toBe(false);
  });

  it("is fine when it is new and short enough", () => {
    expect(fieldNameProblem("Home place", ["North 80"])).toBeNull();
    expect(fieldNameProblem("x".repeat(MAX_FIELD_NAME_LENGTH), [])).toBeNull();
  });

  it("can't be empty", () => {
    expect(fieldNameProblem("   ", [])).toBe("Give each field a name, such as North 80.");
  });

  it("can't be too long for a map label", () => {
    expect(fieldNameProblem("x".repeat(MAX_FIELD_NAME_LENGTH + 1), [])).toContain("is too long. Keep a field's name to 40 letters or fewer.");
  });

  it("can't be a name the farm already has", () => {
    expect(fieldNameProblem("north 80", ["North 80", "South 40"])).toBe(
      "You already have a field called North 80. Give this one a different name.",
    );
  });
});
