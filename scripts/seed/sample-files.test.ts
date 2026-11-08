import {
  area,
  booleanDisjoint,
  booleanPointInPolygon,
  point,
  pointToPolygonDistance,
  polygon,
} from "@turf/turf";
import { describe, expect, it } from "vitest";
import {
  ewktPoint,
  ewktPolygon,
  farmSchema,
  fieldRows,
  fieldSeasonRows,
  findProblems,
  fixedIds,
  loadSampleFiles,
  policyRows,
  seasonSchema,
  unitRows,
  type SampleFiles,
} from "./sample-files";

const files = loadSampleFiles();
const ACRE_M2 = 4046.8564224;

/** A box safely inside Story County, Iowa (the county runs about 93.23–93.70° W, 41.86–42.21° N). */
const STORY_COUNTY_INNER_BOX = { west: -93.69, east: -93.24, south: 41.87, north: 42.2 };

const field = (name: string) => {
  const f = files.fields.find((x) => x.properties.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
};
const outline = (name: string) => polygon(field(name).geometry.coordinates);
const copy = (): SampleFiles => structuredClone(files);

describe("sample files", () => {
  it("load and pass every cross-file check", () => {
    expect(findProblems(files)).toEqual([]);
  });

  it("match spec Part 9", () => {
    const north = field("North 80").properties;
    expect([north.fsa_farm, north.fsa_tract, north.fsa_field]).toEqual(["1234", "5678", "3"]);
    expect(north.expected_acres).toBe(80.2);
    expect(field("South 40").properties.county).toBe("Story");

    expect(files.farm.bins.map((b) => [b.name, b.diameter_ft])).toEqual([
      ["Bin 3", 36],
      ["Bin 4", 30],
    ]);
    expect(files.farm.trucks.map((t) => [t.name, t.capacity_bu])).toEqual([
      ["Truck 1", 1000],
      ["Truck 2", 900],
    ]);
    expect(files.farm.buyers.map((b) => b.name)).toEqual(["Main Street Elevator"]);

    const p = files.season.policy;
    expect([p.crop, p.crop_year, p.plan, p.coverage_level, p.approved_yield]).toEqual([
      "corn",
      2026,
      "RP",
      0.75,
      180,
    ]);
    expect(files.season.units.map((u) => [u.unit_number, u.share_arrangement, u.insured_share])).toEqual([
      ["1", "owned", 1],
      ["2", "crop_share", 0.6667],
    ]);
  });

  it("mark everything SAMPLE", () => {
    expect(files.farm.insured.name).toContain("SAMPLE");
    expect(files.season.policy.policy_number).toContain("SAMPLE");
    for (const b of files.farm.buyers) expect(b.address).toContain("SAMPLE");
    for (const f of files.fields) expect(f.properties.source).toBe("sample");
    // Fixed IDs start with 5eed so sample rows stand out in the Table Editor.
    for (const id of Object.values(fixedIds(files)).flat()) expect(id).toMatch(/^5eed0000-/);
  });

  it("give bin capacities that match the database formula round(0.6312 × d² × eave height)", () => {
    for (const b of files.farm.bins) {
      expect(Math.round(0.6312 * b.diameter_ft ** 2 * b.eave_height_ft)).toBe(b.expected_capacity_bu);
    }
  });
});

describe("map layout", () => {
  const box = STORY_COUNTY_INNER_BOX;
  const insideBox = ([lon, lat]: [number, number]) =>
    lon > box.west && lon < box.east && lat > box.south && lat < box.north;

  it("puts every field, bin and the elevator in Story County", () => {
    for (const f of files.fields) {
      for (const corner of f.geometry.coordinates[0]) expect(insideBox(corner)).toBe(true);
    }
    for (const b of files.farm.bins) expect(insideBox(b.location)).toBe(true);
    for (const b of files.farm.buyers) expect(insideBox(b.location)).toBe(true);
  });

  it("keeps the fields from overlapping", () => {
    expect(booleanDisjoint(outline("North 80"), outline("South 40"))).toBe(true);
  });

  it("keeps the bins outside both fields, at least 50 m from either outline", () => {
    for (const b of files.farm.bins) {
      for (const f of files.fields) {
        const outlineOf = polygon(f.geometry.coordinates);
        expect(booleanPointInPolygon(point(b.location), outlineOf)).toBe(false);
        expect(pointToPolygonDistance(point(b.location), outlineOf, { units: "meters" })).toBeGreaterThan(50);
      }
    }
  });

  it("draws outlines within 0.3% of the expected acres (the database's exact check is in verify.ts)", () => {
    for (const f of files.fields) {
      const acres = area(polygon(f.geometry.coordinates)) / ACRE_M2;
      expect(Math.abs(acres / f.properties.expected_acres - 1)).toBeLessThan(0.003);
    }
  });
});

describe("findProblems", () => {
  it("catches an ID used twice", () => {
    const f = copy();
    f.season.units[1].id = f.season.units[0].id;
    expect(findProblems(f)).toEqual([`ID ${f.season.units[0].id} is used more than once`]);
  });

  it("catches a field season naming an unknown field or unit", () => {
    const f = copy();
    f.season.field_seasons[0].field = "East 20";
    f.season.field_seasons[1].unit = "9";
    expect(findProblems(f)).toEqual([
      `field season ${f.season.field_seasons[0].id} names field "East 20", which is not in farm.geojson`,
      `field season ${f.season.field_seasons[1].id} names unit "9", which is not in season-2026.json`,
    ]);
  });

  it("catches a field with two seasons in one year", () => {
    const f = copy();
    f.season.field_seasons[1].field = "North 80";
    expect(findProblems(f)).toContain('field "North 80" has more than one 2026 field season');
  });
});

describe("schemas", () => {
  it("refuse a share with more decimals than numeric(5,4) keeps", () => {
    const raw = structuredClone(files.season);
    raw.units[1].insured_share = 2 / 3;
    expect(seasonSchema.safeParse(raw).success).toBe(false);
  });

  it("refuse an insured not marked SAMPLE", () => {
    const raw = structuredClone(files.farm);
    raw.insured.name = "Dave's Farm";
    expect(farmSchema.safeParse(raw).success).toBe(false);
  });
});

describe("rows", () => {
  it("write map shapes as EWKT", () => {
    expect(ewktPoint([-93.4006, 42.0911])).toBe("SRID=4326;POINT(-93.4006 42.0911)");
    expect(
      ewktPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toBe("SRID=4326;POLYGON((0 0,1 0,1 1,0 0))");
  });

  it("give fields to the sample insured, marked source 'sample'", () => {
    for (const row of fieldRows(files)) {
      expect(row.insured_id).toBe(files.farm.insured.id);
      expect(row.source).toBe("sample");
      expect(row.boundary).toMatch(/^SRID=4326;POLYGON\(\(/);
    }
  });

  it("link field seasons to the right field and unit", () => {
    const unitId = (n: string) => files.season.units.find((u) => u.unit_number === n)?.id;
    expect(fieldSeasonRows(files).map((r) => [r.field_id, r.unit_id, r.crop_year, r.planted_acres])).toEqual([
      [field("North 80").id, unitId("1"), 2026, 80.2],
      [field("South 40").id, unitId("2"), 2026, 40],
    ]);
  });

  it("link the policy to the insured and units to the policy", () => {
    expect(policyRows(files)[0].insured_id).toBe(files.farm.insured.id);
    for (const u of unitRows(files)) expect(u.policy_id).toBe(files.season.policy.id);
  });
});
