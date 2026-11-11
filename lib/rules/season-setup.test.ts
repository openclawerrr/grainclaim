import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { loadSampleFiles } from "../../scripts/seed/sample-files";
import {
  MAP_ACRE_TOLERANCE,
  mapDiffers,
  proposeSeason,
  type MappedField,
  type SeasonCoverage,
  type SeasonFsa578,
  type SeasonProposal,
} from "./season-setup";

// The SAMPLE documents as printed, and the sample farm's fields as the database holds them.
const documents = loadDocumentsFile();
const FSA: SeasonFsa578 = documentsOfKind(documents, "fsa_578")[0][1].values;
const COVERAGE: SeasonCoverage = documentsOfKind(documents, "summary_of_coverage")[0][1].values;
const sample = loadSampleFiles();
const FIELDS: MappedField[] = sample.fields.map((f) => ({
  id: f.id,
  name: f.properties.name,
  fsa_farm: f.properties.fsa_farm,
  fsa_tract: f.properties.fsa_tract,
  fsa_field: f.properties.fsa_field,
  mapped_acres: f.properties.expected_acres,
}));
const [NORTH, SOUTH] = FIELDS;
/** A seeded row without its fixed id, to compare with what the documents give. */
function withoutId<T extends { id: string }>(row: T): Omit<T, "id"> {
  const copy: Partial<T> = { ...row };
  delete copy.id;
  return copy as Omit<T, "id">;
}

const proposal = (fsa = FSA, coverage = COVERAGE, fields = FIELDS): SeasonProposal => {
  const result = proposeSeason(fsa, coverage, fields);
  if (!result.ok) throw new Error(`not set up: ${result.problems.join(" | ")}`);
  return result.proposal;
};
const problems = (fsa = FSA, coverage = COVERAGE, fields = FIELDS): string[] => {
  const result = proposeSeason(fsa, coverage, fields);
  return result.ok ? [] : result.problems;
};
type Line = SeasonFsa578["fields"][number];
type Unit = SeasonCoverage["units"][number];
const withLine = (index: number, changes: Partial<Line>): SeasonFsa578 => ({
  ...FSA,
  fields: FSA.fields.map((line, i) => (i === index ? { ...line, ...changes } : line)),
});
const withUnit = (index: number, changes: Partial<Unit>): SeasonCoverage => ({
  ...COVERAGE,
  units: COVERAGE.units.map((unit, i) => (i === index ? { ...unit, ...changes } : unit)),
});

describe("the sample documents", () => {
  const season = proposal();

  it("set up Units 1 and 2 with guarantees of 10,827 and 3,600 bushels", () => {
    expect(season.units.map((unit) => [unit.unitNumber, Math.round(unit.guaranteeBu)])).toEqual([
      ["1", 10_827],
      ["2", 3_600],
    ]);
    // Unrounded: 180 × 0.75 × 80.20 × 1 and 180 × 0.75 × 40 × 0.6667.
    expect(season.units[0].guaranteeBu).toBeCloseTo(10_827, 9);
    expect(season.units[1].guaranteeBu).toBeCloseTo(3_600.18, 9);
  });

  it("fire one flag: North 80's acres differ between the FSA-578 and the Summary of Coverage", () => {
    expect(season.flags).toEqual([
      {
        type: "acre_mismatch",
        message:
          "North 80: your FSA-578 shows 80.20 acres, but your Summary of Coverage shows 80.00. Your map measures 80.20. Tell your agent before harvest.",
        about: { record: "field", fieldId: NORTH.id },
        fieldIds: [NORTH.id],
      },
    ]);
    expect(season.uninsuredFields).toEqual([]);
  });

  it("take the policy from the Summary of Coverage, as the seed's season has it", () => {
    expect(season.policy).toEqual(withoutId(sample.season.policy));
  });

  it("make the units the seed's season has: Unit 1 owned at 100%, Unit 2 a crop share at 0.6667", () => {
    expect(
      season.units.map((unit) => ({
        unit_number: unit.unitNumber,
        unit_type: unit.unitType,
        practice: unit.practice,
        share_arrangement: unit.shareArrangement,
        insured_share: unit.insuredShare,
      })),
    ).toEqual(sample.season.units.map(withoutId));
  });

  it("put each field in its unit by FSA farm, tract and field, with the FSA-578's planted acres and date", () => {
    expect(
      season.units.flatMap((unit) =>
        unit.fields.map((field) => ({
          field: field.fieldName,
          unit: unit.unitNumber,
          crop: field.crop,
          planted_acres: field.plantedAcres,
          planting_date: field.plantingDate,
          practice: field.practice,
        })),
      ),
    ).toEqual(
      sample.season.field_seasons.map((fs) => ({
        field: fs.field,
        unit: fs.unit,
        crop: fs.crop,
        planted_acres: fs.planted_acres,
        planting_date: fs.planting_date,
        practice: fs.practice,
      })),
    );
    expect(season.units[0].fields[0].fieldId).toBe(NORTH.id);
    expect(season.units[1].fields[0].fieldId).toBe(SOUTH.id);
  });

  it("keep all three acre figures for each unit: planted 80.20, covered 80.00, mapped 80.20", () => {
    expect(season.units.map((u) => [u.plantedAcres, u.coverageAcres, u.fields[0].mappedAcres])).toEqual([
      [80.2, 80, 80.2],
      [40, 40, 40],
    ]);
  });

  it("guarantee from the FSA-578's planted acres, not the Summary of Coverage's own 10,800", () => {
    expect(documentsOfKind(documents, "summary_of_coverage")[0][1].values.units[0].guarantee_bu).toBe(10_800);
    expect(Math.round(season.units[0].guaranteeBu)).toBe(10_827);
  });
});

describe("matching by FSA numbers", () => {
  it("doesn't depend on the order of the lines, the units or the fields", () => {
    const reversed = proposal(
      { ...FSA, fields: [...FSA.fields].reverse() },
      { ...COVERAGE, units: [...COVERAGE.units].reverse() },
      [...FIELDS].reverse(),
    );
    const byUnit = (season: SeasonProposal) =>
      Object.fromEntries(season.units.map((u) => [u.unitNumber, [u.fields.map((f) => f.fieldName), Math.round(u.guaranteeBu)]]));
    expect(byUnit(reversed)).toEqual(byUnit(proposal()));
    expect(reversed.flags.map((f) => f.type)).toEqual(["acre_mismatch"]);
  });

  it("doesn't go by a field's name", () => {
    const renamed = FIELDS.map((f) => ({ ...f, name: f === NORTH ? "Home place" : "Pat's ground" }));
    const season = proposal(FSA, COVERAGE, renamed);
    expect(season.units.map((u) => u.fields[0].fieldName)).toEqual(["Home place", "Pat's ground"]);
    expect(season.flags[0].message).toMatch(/^Home place: /);
  });

  it("can't set up a unit whose field isn't on the map", () => {
    expect(problems(FSA, COVERAGE, [NORTH])).toEqual([
      "Unit 2 covers FSA farm 1234, tract 6012, field 1, which isn't on your farm map. Add that field to the map first.",
    ]);
  });

  it("can't set up two units on one field, or a unit whose FSA numbers weren't read", () => {
    expect(problems(FSA, withUnit(1, { fsa_tract: "5678", fsa_field: "3" }))).toEqual([
      "North 80 is in both Unit 1 and Unit 2 on the Summary of Coverage.",
    ]);
    expect(problems(FSA, withUnit(1, { fsa_tract: null }))).toEqual([
      "Unit 2's FSA farm and tract numbers couldn't be read from the Summary of Coverage.",
    ]);
  });
});

describe("flags", () => {
  it("flags a mapped field that isn't on the FSA-578 as possibly unreported or uninsured", () => {
    const west: MappedField = { id: "west-20", name: "West 20", fsa_farm: "1234", fsa_tract: "5678", fsa_field: "7", mapped_acres: 20.1 };
    const season = proposal(FSA, COVERAGE, [...FIELDS, west]);
    expect(season.flags.filter((f) => f.type === "unreported_field")).toEqual([
      {
        type: "unreported_field",
        message:
          "West 20 is on your farm map but not on your FSA-578. Its acres may be unreported or uninsured. Ask your FSA office or your agent.",
        about: { record: "field", fieldId: "west-20" },
        fieldIds: ["west-20"],
      },
    ]);
    // The season is still set up for the fields that are there.
    expect(season.units.map((u) => Math.round(u.guaranteeBu))).toEqual([10_827, 3_600]);
  });

  it("flags an insured field left off the FSA-578, and its unit then has no acres and no guarantee", () => {
    const season = proposal({ ...FSA, fields: [FSA.fields[0]] });
    expect(season.flags.map((f) => [f.type, f.about])).toEqual([
      ["unreported_field", { record: "field", fieldId: SOUTH.id }],
      ["acre_mismatch", { record: "field", fieldId: NORTH.id }],
    ]);
    expect(season.units[1]).toMatchObject({ unitNumber: "2", fields: [], plantedAcres: 0, guaranteeBu: 0 });
  });

  it("flags a field with no FSA numbers, which can't be on any FSA-578", () => {
    const unnumbered: MappedField = { id: "drawn", name: "Creek bottom", fsa_farm: null, fsa_tract: null, fsa_field: null, mapped_acres: 12 };
    expect(proposal(FSA, COVERAGE, [...FIELDS, unnumbered]).flags.map((f) => [f.type, f.about])).toContainEqual([
      "unreported_field",
      { record: "field", fieldId: "drawn" },
    ]);
  });

  it("keeps a reported field that is in no unit, as not insured: a season with its acres, no unit and no guarantee", () => {
    const west: MappedField = { id: "west-20", name: "West 20", fsa_farm: "1234", fsa_tract: "9001", fsa_field: "7", mapped_acres: 20 };
    const line: Line = { ...FSA.fields[0], tract: "9001", field: "7", reported_acres: 20, planting_date: "2026-05-04" };
    const season = proposal({ ...FSA, fields: [...FSA.fields, line] }, COVERAGE, [...FIELDS, west]);

    expect(season.uninsuredFields).toEqual([
      {
        fieldId: "west-20",
        fieldName: "West 20",
        crop: "corn",
        plantedAcres: 20,
        plantingDate: "2026-05-04",
        practice: "non-irrigated",
        mappedAcres: 20,
        coverageAcres: null,
        coverageTract: null,
      },
    ]);
    // The flag for the agent stays.
    expect(season.flags.filter((f) => f.type === "uninsured_field")).toEqual([
      {
        type: "uninsured_field",
        message: "West 20 is on your FSA-578 but isn't in any unit on your Summary of Coverage, so it may be uninsured. Ask your agent.",
        about: { record: "field", fieldId: "west-20" },
        fieldIds: ["west-20"],
      },
    ]);
    // It is in no unit, and no unit's acres or guarantee count it.
    expect(season.units.flatMap((u) => u.fields.map((f) => f.fieldName))).toEqual(["North 80", "South 40"]);
    expect(season.units.map((u) => [u.plantedAcres, Math.round(u.guaranteeBu)])).toEqual([
      [80.2, 10_827],
      [40, 3_600],
    ]);
  });

  it("still checks an uninsured field's outline against its reported acres", () => {
    const west: MappedField = { id: "west-20", name: "West 20", fsa_farm: "1234", fsa_tract: "9001", fsa_field: "7", mapped_acres: 23 };
    const line: Line = { ...FSA.fields[0], tract: "9001", field: "7", reported_acres: 20 };
    const season = proposal({ ...FSA, fields: [...FSA.fields, line] }, COVERAGE, [...FIELDS, west]);
    expect(season.flags.filter((f) => f.fieldIds.includes("west-20")).map((f) => f.type)).toEqual(["uninsured_field", "acre_mismatch"]);
  });

  it("flags an FSA-578 line for a field that isn't on the map", () => {
    const line: Line = { ...FSA.fields[0], tract: "9001", field: "2", reported_acres: 15 };
    const season = proposal({ ...FSA, fields: [...FSA.fields, line] });
    expect(season.flags.filter((f) => f.type === "field_not_on_map")).toEqual([
      {
        type: "field_not_on_map",
        message:
          "FSA farm 1234, tract 9001, field 2 is on your FSA-578 but not on your farm map, so nothing was set up for it. Add the field to the map if you farm it.",
        about: { record: "fsa_578" },
        fieldIds: [],
      },
    ]);
  });

  it("raises no flag when the three acre figures agree", () => {
    expect(proposal(FSA, withUnit(0, { acres: 80.2 })).flags).toEqual([]);
  });
});

describe("acres that differ", () => {
  it("flags any difference between the two documents, which both print to the hundredth", () => {
    expect(proposal(FSA, withUnit(0, { acres: 80.19 })).flags.map((f) => f.type)).toEqual(["acre_mismatch"]);
    expect(proposal(withLine(1, { reported_acres: 40.01 })).flags.map((f) => f.about)).toEqual([
      { record: "field", fieldId: NORTH.id },
      { record: "field", fieldId: SOUTH.id },
    ]);
  });

  it("flags the map only when it is more than 1% off the FSA-578", () => {
    expect(MAP_ACRE_TOLERANCE).toBe(0.01);
    expect(mapDiffers(80.2, 80.2)).toBe(false);
    expect(mapDiffers(79.5, 80.2)).toBe(false); // 0.9% under
    expect(mapDiffers(81, 80.2)).toBe(false); // 1.0% over
    expect(mapDiffers(79.3, 80.2)).toBe(true); // 1.1% under
    expect(mapDiffers(81.1, 80.2)).toBe(true);
    expect(mapDiffers(null, 80.2)).toBe(false);
  });

  it("flags a field whose outline is well off its reported acres, on the field", () => {
    const shrunk = FIELDS.map((f) => (f === SOUTH ? { ...f, mapped_acres: 38.9 } : f));
    const season = proposal(FSA, COVERAGE, shrunk);
    expect(season.flags.map((f) => [f.about, f.message])).toEqual([
      [
        { record: "field", fieldId: NORTH.id },
        "North 80: your FSA-578 shows 80.20 acres, but your Summary of Coverage shows 80.00. Your map measures 80.20. Tell your agent before harvest.",
      ],
      [
        { record: "field", fieldId: SOUTH.id },
        "South 40: your map measures 38.90 acres, but your FSA-578 shows 40.00. Check the field's outline, or tell your agent if the FSA-578 is wrong.",
      ],
    ]);
  });

  it("says it once when one field's three figures all differ", () => {
    const off = FIELDS.map((f) => (f === NORTH ? { ...f, mapped_acres: 78 } : f));
    expect(proposal(FSA, COVERAGE, off).flags.map((f) => f.message)).toEqual([
      "North 80: your FSA-578 shows 80.20 acres, but your Summary of Coverage shows 80.00. Your map measures 78.00. Tell your agent before harvest.",
    ]);
  });
});

describe("a unit with several fields", () => {
  // East 40 is a second field in North 80's tract: 40.30 acres on the FSA-578 and on the map.
  const EAST: MappedField = { id: "east-40", name: "East 40", fsa_farm: "1234", fsa_tract: "5678", fsa_field: "4", mapped_acres: 40.3 };
  const THREE_FIELDS = [...FIELDS, EAST];
  const FSA_3: SeasonFsa578 = { ...FSA, fields: [...FSA.fields, { ...FSA.fields[0], field: "4", reported_acres: 40.3, planting_date: "2026-04-30" }] };
  const [UNIT_1, UNIT_2] = COVERAGE.units;
  /** The summary with a second row for Unit 1 that names East 40. */
  const twoRows = (changes: Partial<Unit> = {}): SeasonCoverage => ({
    ...COVERAGE,
    units: [UNIT_1, { ...UNIT_1, fsa_field: "4", acres: 40.3, ...changes }, UNIT_2],
  });
  /** The summary with one row for Unit 1 that covers all of tract 5678. */
  const tractRow = (acres: number | null): SeasonCoverage => ({
    ...COVERAGE,
    units: [{ ...UNIT_1, fsa_field: null, acres }, UNIT_2],
  });

  it("treats rows with the same unit number as one unit with several fields", () => {
    const season = proposal(FSA_3, twoRows(), THREE_FIELDS);
    expect(season.units.map((u) => [u.unitNumber, u.fields.map((f) => f.fieldName)])).toEqual([
      ["1", ["North 80", "East 40"]],
      ["2", ["South 40"]],
    ]);
    expect(season.uninsuredFields).toEqual([]);
  });

  it("adds up the unit's fields for its acres and its guarantee", () => {
    const [unit1, unit2] = proposal(FSA_3, twoRows(), THREE_FIELDS).units;
    expect(unit1.plantedAcres).toBeCloseTo(120.5, 9);
    // The summary's own acres for the unit are its rows added up: 80.00 + 40.30.
    expect(unit1.coverageAcres).toBeCloseTo(120.3, 9);
    // 180 × 0.75 × 120.50 × 1
    expect(unit1.guaranteeBu).toBeCloseTo(16_267.5, 9);
    expect(Math.round(unit2.guaranteeBu)).toBe(3_600);
  });

  it("checks acres field by field: only North 80's row disagrees", () => {
    const season = proposal(FSA_3, twoRows(), THREE_FIELDS);
    expect(season.flags).toEqual([
      {
        type: "acre_mismatch",
        message:
          "North 80: your FSA-578 shows 80.20 acres, but your Summary of Coverage shows 80.00. Your map measures 80.20. Tell your agent before harvest.",
        about: { record: "field", fieldId: NORTH.id },
        fieldIds: [NORTH.id],
      },
    ]);
    const east = season.units[0].fields[1];
    expect([east.plantedAcres, east.coverageAcres, east.mappedAcres, east.coverageTract]).toEqual([40.3, 40.3, 40.3, null]);
  });

  it("flags each field of the unit on its own", () => {
    const season = proposal(FSA_3, twoRows({ acres: 40 }), [...FIELDS, { ...EAST, mapped_acres: 41.5 }]);
    expect(season.flags.map((f) => [f.about, f.message])).toEqual([
      [
        { record: "field", fieldId: NORTH.id },
        "North 80: your FSA-578 shows 80.20 acres, but your Summary of Coverage shows 80.00. Your map measures 80.20. Tell your agent before harvest.",
      ],
      [
        { record: "field", fieldId: "east-40" },
        "East 40: your FSA-578 shows 40.30 acres, but your Summary of Coverage shows 40.00. Your map measures 41.50. Tell your agent before harvest.",
      ],
    ]);
  });

  it("stops with one sentence when a unit's rows disagree on its type, practice or share", () => {
    expect(problems(FSA_3, twoRows({ insured_share: 0.5 }), THREE_FIELDS)).toEqual([
      "Unit 1 has rows on the Summary of Coverage that disagree on its share, so it can't be set up. Ask your agent which is right.",
    ]);
    expect(problems(FSA_3, twoRows({ unit_type: "optional", practice: "irrigated" }), THREE_FIELDS)).toEqual([
      "Unit 1 has rows on the Summary of Coverage that disagree on its type and practice, so it can't be set up. Ask your agent which is right.",
    ]);
    expect(problems(FSA_3, twoRows({ unit_type: "optional", practice: "irrigated", insured_share: 0.5 }), THREE_FIELDS)).toEqual([
      "Unit 1 has rows on the Summary of Coverage that disagree on its type, practice and share, so it can't be set up. Ask your agent which is right.",
    ]);
  });

  it("can't take the same field twice in a unit", () => {
    expect(problems(FSA_3, twoRows({ fsa_field: "3" }), THREE_FIELDS)).toEqual([
      "North 80 is listed twice in Unit 1 on the Summary of Coverage.",
    ]);
  });

  it("lets a row with a farm and tract but no field number cover every FSA-578 line in that tract", () => {
    const season = proposal(FSA_3, tractRow(120.5), THREE_FIELDS);
    expect(season.units[0].fields.map((f) => [f.fieldName, f.plantedAcres, f.coverageAcres, f.coverageTract])).toEqual([
      ["North 80", 80.2, 120.5, "5678"],
      ["East 40", 40.3, 120.5, "5678"],
    ]);
    expect(season.units[0].plantedAcres).toBeCloseTo(120.5, 9);
    expect(season.units[0].guaranteeBu).toBeCloseTo(16_267.5, 9);
    expect(season.flags).toEqual([]);
    // South 40 is in another tract and keeps its own row.
    expect(season.units[1].fields.map((f) => f.fieldName)).toEqual(["South 40"]);
  });

  it("compares a tract row with its fields' FSA-578 acres added up, and each field with the map", () => {
    const season = proposal(FSA_3, tractRow(120), [...FIELDS, { ...EAST, mapped_acres: 38 }]);
    expect(season.flags).toEqual([
      {
        type: "acre_mismatch",
        message:
          "Tract 5678 (North 80 and East 40): your FSA-578 shows 120.50 acres, but your Summary of Coverage shows 120.00 for the tract. Tell your agent before harvest.",
        about: { record: "unit", unitNumber: "1" },
        fieldIds: [NORTH.id, "east-40"],
      },
      {
        type: "acre_mismatch",
        message:
          "East 40: your map measures 38.00 acres, but your FSA-578 shows 40.30. Check the field's outline, or tell your agent if the FSA-578 is wrong.",
        about: { record: "field", fieldId: "east-40" },
        fieldIds: ["east-40"],
      },
    ]);
  });

  it("treats a tract row over a single field like a row that names it", () => {
    const season = proposal(FSA, tractRow(80), FIELDS);
    expect(season.units[0].fields.map((f) => [f.fieldName, f.coverageAcres, f.coverageTract])).toEqual([["North 80", 80, null]]);
    expect(season.flags.map((f) => [f.about, f.message])).toEqual([
      [
        { record: "field", fieldId: NORTH.id },
        "North 80: your FSA-578 shows 80.20 acres, but your Summary of Coverage shows 80.00. Your map measures 80.20. Tell your agent before harvest.",
      ],
    ]);
  });

  it("lets a row that names a field take it out of a row for its tract", () => {
    // Unit 1 covers tract 5678; Unit 3 names East 40 on its own.
    const coverage: SeasonCoverage = {
      ...COVERAGE,
      units: [{ ...UNIT_1, fsa_field: null, acres: 80.2 }, UNIT_2, { ...UNIT_1, unit_number: "3", fsa_field: "4", acres: 40.3 }],
    };
    const season = proposal(FSA_3, coverage, THREE_FIELDS);
    expect(season.units.map((u) => [u.unitNumber, u.fields.map((f) => f.fieldName)])).toEqual([
      ["1", ["North 80"]],
      ["2", ["South 40"]],
      ["3", ["East 40"]],
    ]);
    expect(season.flags).toEqual([]);
  });

  it("can't set up a tract that the FSA-578 has nothing in, or that two rows cover", () => {
    expect(problems(FSA, withUnit(1, { fsa_tract: "7000", fsa_field: null }))).toEqual([
      "Unit 2 covers FSA farm 1234, tract 7000, but your FSA-578 has no corn in that tract.",
    ]);
    const twice: SeasonCoverage = { ...COVERAGE, units: [{ ...UNIT_1, fsa_field: null }, { ...UNIT_2, fsa_tract: "5678", fsa_field: null }] };
    expect(problems(FSA, twice)).toEqual(["FSA farm 1234, tract 5678 is in both Unit 1 and Unit 2 on the Summary of Coverage."]);
  });

  it("keeps a field of the tract that the summary's rows leave out, as not insured", () => {
    // The summary still names only North 80 for Unit 1, so East 40 is in no unit.
    const season = proposal(FSA_3, COVERAGE, THREE_FIELDS);
    expect(season.uninsuredFields.map((f) => [f.fieldName, f.plantedAcres])).toEqual([["East 40", 40.3]]);
    expect(season.flags.map((f) => f.type)).toEqual(["uninsured_field", "acre_mismatch"]);
    expect(season.units[0]).toMatchObject({ plantedAcres: 80.2, fields: [{ fieldName: "North 80" }] });
  });
});

describe("what stops a season from being set up", () => {
  it("documents for different years", () => {
    expect(problems({ ...FSA, program_year: 2025 })).toEqual([
      "The FSA-578 is for 2025 but the Summary of Coverage is for 2026. Add the two for the same year.",
    ]);
  });

  it("policy values that weren't read", () => {
    expect(problems(FSA, { ...COVERAGE, coverage_level: null, plan: null })).toEqual([
      "The Summary of Coverage's plan and coverage level couldn't be read, so the season can't be set up from it.",
    ]);
    expect(problems(FSA, { ...COVERAGE, crop: null })).toEqual([
      "The Summary of Coverage's crop couldn't be read, so the season can't be set up from it.",
    ]);
  });

  it("a coverage level that can't be right", () => {
    expect(problems(FSA, { ...COVERAGE, coverage_level: 7.5 })).toEqual([
      "The Summary of Coverage's coverage level reads 750%, which can't be right.",
    ]);
  });

  it("units with different approved yields, or one that wasn't read", () => {
    expect(problems(FSA, withUnit(1, { approved_yield: 165 }))).toEqual([
      "The units on the Summary of Coverage have different approved yields (180 and 165). GrainClaim keeps one approved yield per policy, so it can't set this season up yet.",
    ]);
    expect(problems(FSA, withUnit(0, { approved_yield: null }))).toEqual([
      "A unit's approved yield couldn't be read from the Summary of Coverage.",
    ]);
  });

  it("a unit with no number, rows that disagree, or no share", () => {
    expect(problems(FSA, withUnit(1, { unit_number: null }))).toContain("A unit's number couldn't be read from the Summary of Coverage.");
    // The same number on two rows is one unit; here its two rows disagree on the share.
    expect(problems(FSA, withUnit(1, { unit_number: "1" }))).toEqual([
      "Unit 1 has rows on the Summary of Coverage that disagree on its share, so it can't be set up. Ask your agent which is right.",
    ]);
    expect(problems(FSA, withUnit(1, { insured_share: null }))).toEqual(["Unit 2's share couldn't be read from the Summary of Coverage."]);
    expect(problems(FSA, withUnit(1, { insured_share: 66.67 }))).toEqual(["Unit 2's share couldn't be read from the Summary of Coverage."]);
  });

  it("acres that weren't read for an insured field, or a field listed twice", () => {
    expect(problems(withLine(0, { reported_acres: null }))).toEqual(["North 80's acres couldn't be read from the FSA-578."]);
    expect(problems({ ...FSA, fields: [...FSA.fields, FSA.fields[0]] })).toEqual([
      "North 80 is on the FSA-578 more than once for corn. GrainClaim keeps one crop per field each year.",
    ]);
  });

  it("an FSA-578 or a Summary of Coverage with nothing on it", () => {
    expect(problems({ ...FSA, fields: [] })).toContain("No fields could be read from the FSA-578.");
    expect(problems(FSA, { ...COVERAGE, units: [] })).toContain("No units could be read from the Summary of Coverage.");
    expect(problems({ ...FSA, program_year: null, farm_number: null })).toEqual([
      "The FSA-578's program year couldn't be read.",
      "The FSA-578's farm number couldn't be read.",
    ]);
  });

  it("says every problem at once, and proposes nothing", () => {
    const result = proposeSeason({ ...FSA, program_year: 2025 }, withUnit(1, { insured_share: null }), [NORTH]);
    expect(result).toEqual({
      ok: false,
      problems: [
        "The FSA-578 is for 2025 but the Summary of Coverage is for 2026. Add the two for the same year.",
        "Unit 2's share couldn't be read from the Summary of Coverage.",
        "Unit 2 covers FSA farm 1234, tract 6012, field 1, which isn't on your farm map. Add that field to the map first.",
      ],
    });
  });
});

describe("details", () => {
  it("leaves another crop's lines to another policy, without calling their fields unreported", () => {
    const season = proposal(withLine(1, { crop: "soybeans" }));
    expect(season.units[1].fields).toEqual([]);
    expect(season.flags.map((f) => f.type)).toEqual(["acre_mismatch"]);
  });

  it("turns the FSA-578's practice codes into words, and a 100% share into owned", () => {
    expect(proposal(withLine(0, { practice: "I" })).units[0].fields[0].practice).toBe("irrigated");
    expect(proposal(withLine(0, { practice: null })).units[0].fields[0].practice).toBe("non-irrigated");
    expect(proposal().units.map((u) => u.shareArrangement)).toEqual(["owned", "crop_share"]);
  });

  it("insures at the full price when the summary prints no price election, and takes the unit type from the policy when a unit prints none", () => {
    expect(proposal(FSA, { ...COVERAGE, price_election: null }).policy.price_election).toBe(1);
    expect(proposal(FSA, withUnit(0, { unit_type: null })).units[0].unitType).toBe("basic");
  });

  it("keeps a share to four decimals, as the database does", () => {
    expect(proposal(FSA, withUnit(1, { insured_share: 2 / 3 })).units[1].insuredShare).toBe(0.6667);
  });
});
