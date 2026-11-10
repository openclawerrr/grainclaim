import { area } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { databaseAcres, ellipsoidSquareMeters, exactAcres, SQUARE_METERS_PER_ACRE } from "./acres";
import { loadOutlineInputs } from "./files";

const { fields, clip } = loadOutlineInputs();
const rectangle = (west: number, south: number, east: number, north: number) => ({
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

/**
 * Square meters from DuckDB's ST_Area_Spheroid (GeographicLib, WGS 84), which
 * measures the way PostGIS measures ST_Area(boundary::geography):
 *
 *   duckdb -c "LOAD spatial; SET geometry_always_xy = true;
 *     SELECT name, ST_Area_Spheroid(geom) FROM ST_Read('sample-data/farm.geojson');"
 */
const DUCKDB_FIELDS: Record<string, number> = { "North 80": 324557.864, "South 40": 161875.802 };
const DUCKDB_CLIP: Record<string, number> = {
  "191623001171071": 81334.376,
  "191623001171118": 945806.527,
  // This one has a hole in it: the farmstead it surrounds.
  "191623001171149": 1207192.209,
  "191623001171158": 325421.126,
  "191623001171261": 641682.926,
};
/** The first sample fields: plain rectangles that the database measured at exactly 80.20 and 40.00 acres. */
const FIRST_NORTH_80 = rectangle(-93.412, 42.0903, -93.4022493, 42.0939222);
const FIRST_SOUTH_40 = rectangle(-93.412, 42.0860778, -93.4071371, 42.0897);

describe("the database's acre measure", () => {
  it("agrees with DuckDB's spheroid area on Dave's fields to a tenth of a square meter", () => {
    for (const field of fields) {
      expect(Math.abs(ellipsoidSquareMeters(field.geometry) - DUCKDB_FIELDS[field.name]), field.name).toBeLessThan(0.1);
    }
  });

  it("agrees with DuckDB on real outlines from 20 to 300 acres, one of them with a hole", () => {
    for (const [id, squareMeters] of Object.entries(DUCKDB_CLIP)) {
      const outline = clip.find((c) => c.properties.id === id);
      expect(outline, id).toBeDefined();
      expect(Math.abs(ellipsoidSquareMeters(outline!.geometry) - squareMeters), id).toBeLessThan(0.1);
    }
    expect(clip.find((c) => c.properties.id === "191623001171149")!.geometry.coordinates).toHaveLength(2);
  });

  it("gives the acres the database stored for the first sample fields", () => {
    expect(Math.abs(ellipsoidSquareMeters(FIRST_NORTH_80) - 324559.251)).toBeLessThan(0.1);
    expect(Math.abs(ellipsoidSquareMeters(FIRST_SOUTH_40) - 161875.833)).toBeLessThan(0.1);
    expect(databaseAcres(FIRST_NORTH_80)).toBe(80.2);
    expect(databaseAcres(FIRST_SOUTH_40)).toBe(40);
  });

  it("measures the same whichever way round the outline is drawn", () => {
    const ring = fields[0].geometry.coordinates[0];
    const backward = { coordinates: [[...ring].reverse()] };
    expect(ellipsoidSquareMeters(backward)).toBeCloseTo(ellipsoidSquareMeters(fields[0].geometry), 6);
  });

  it("takes a hole out of the outline", () => {
    const outer = rectangle(-93.42, 42.09, -93.41, 42.1);
    const hole = rectangle(-93.418, 42.092, -93.416, 42.094);
    const holed = { coordinates: [outer.coordinates[0], hole.coordinates[0]] };
    expect(ellipsoidSquareMeters(holed)).toBeCloseTo(ellipsoidSquareMeters(outer) - ellipsoidSquareMeters(hole), 6);
  });

  it("turns square meters into acres, and rounds to two decimals only for the stored figure", () => {
    const acre = rectangle(-93.42, 42.09, -93.41, 42.1);
    expect(exactAcres(acre)).toBe(ellipsoidSquareMeters(acre) / SQUARE_METERS_PER_ACRE);
    expect(databaseAcres(acre)).toBe(Math.round(exactAcres(acre) * 100) / 100);
  });

  it("differs from Turf's sphere measure by enough to change the stored acres", () => {
    const north80 = fields.find((f) => f.name === "North 80")!;
    const onASphere = area({ type: "Feature", properties: {}, geometry: north80.geometry }) / SQUARE_METERS_PER_ACRE;
    expect(databaseAcres(north80.geometry)).toBe(80.2);
    expect(Math.round(onASphere * 100) / 100).toBe(80.08);
  });
});
