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
        about: { record: "unit", unitNumber: "1" },
        fieldIds: [NORTH.id],
      },
    ]);
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
      "Unit 2's FSA farm, tract and field numbers couldn't be read from the Summary of Coverage.",
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
      ["acre_mismatch", { record: "unit", unitNumber: "1" }],
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

  it("flags a reported field that is in no unit as possibly uninsured, and doesn't put it in a unit", () => {
    const west: MappedField = { id: "west-20", name: "West 20", fsa_farm: "1234", fsa_tract: "5678", fsa_field: "7", mapped_acres: 20 };
    const line: Line = { ...FSA.fields[0], field: "7", reported_acres: 20 };
    const season = proposal({ ...FSA, fields: [...FSA.fields, line] }, COVERAGE, [...FIELDS, west]);
    expect(season.flags.filter((f) => f.type === "uninsured_field")).toEqual([
      {
        type: "uninsured_field",
        message: "West 20 is on your FSA-578 but isn't in any unit on your Summary of Coverage, so it may be uninsured. Ask your agent.",
        about: { record: "field", fieldId: "west-20" },
        fieldIds: ["west-20"],
      },
    ]);
    expect(season.units.flatMap((u) => u.fields.map((f) => f.fieldName))).toEqual(["North 80", "South 40"]);
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
      { record: "unit", unitNumber: "1" },
      { record: "unit", unitNumber: "2" },
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
        { record: "unit", unitNumber: "1" },
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

  it("doesn't add a second field to a unit: the summary names one field per unit, so the other is flagged as possibly uninsured", () => {
    const east: MappedField = { id: "east-40", name: "East 40", fsa_farm: "1234", fsa_tract: "5678", fsa_field: "4", mapped_acres: 40.3 };
    const fsa: SeasonFsa578 = { ...FSA, fields: [...FSA.fields, { ...FSA.fields[0], field: "4", reported_acres: 40.3 }] };
    const season = proposal(fsa, COVERAGE, [...FIELDS, east]);
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

  it("a unit with no number, a number used twice, or no share", () => {
    expect(problems(FSA, withUnit(1, { unit_number: null }))).toContain("A unit's number couldn't be read from the Summary of Coverage.");
    expect(problems(FSA, withUnit(1, { unit_number: "1" }))).toContain("Unit 1 is on the Summary of Coverage twice.");
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
