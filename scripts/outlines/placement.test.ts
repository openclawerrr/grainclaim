import { describe, expect, it } from "vitest";
import { databaseAcres, exactAcres } from "./acres";
import { loadOutlineInputs } from "./files";
import { sharedSquareMeters } from "./outlines";
import { cutToAcres, PLACEMENTS, placeFields, type LonLat } from "./placement";

const { fields, clip } = loadOutlineInputs();
const placed = placeFields(clip);
const source = (csbId: string) => {
  const found = clip.find((c) => c.properties.id === csbId);
  if (!found) throw new Error(`no CSB ${csbId}`);
  return found.geometry;
};
const edges = (ring: readonly (readonly number[])[]) => ({
  west: Math.min(...ring.map(([lon]) => lon)),
  east: Math.max(...ring.map(([lon]) => lon)),
  south: Math.min(...ring.map(([, lat]) => lat)),
  north: Math.max(...ring.map(([, lat]) => lat)),
});

describe("Dave's fields in farm.geojson", () => {
  it("are exactly the outlines cut from their real fields", () => {
    expect(PLACEMENTS.map((p) => p.name)).toEqual(fields.map((f) => f.name));
    for (const field of fields) {
      const cut = placed.find((p) => p.name === field.name);
      expect(cut, field.name).toBeDefined();
      expect(field.geometry, `${field.name} in farm.geojson differs from scripts/outlines/placement.ts`).toEqual(cut!.geometry);
    }
  });

  it("measure the acres farm.geojson expects, the way the database measures them", () => {
    expect(fields.map((f) => [f.name, f.expected_acres])).toEqual([["North 80", 80.2], ["South 40", 40]]);
    for (const field of fields) {
      expect(databaseAcres(field.geometry), field.name).toBe(field.expected_acres);
      // Well inside the rounding, so a different computer's arithmetic can't tip it.
      expect(Math.abs(exactAcres(field.geometry) - field.expected_acres), field.name).toBeLessThan(0.001);
    }
  });

  it("are closed rings with no repeated points, stored to seven decimals", () => {
    for (const field of fields) {
      expect(field.geometry.coordinates).toHaveLength(1);
      const ring = field.geometry.coordinates[0];
      expect(ring.at(-1)).toEqual(ring[0]);
      for (const [i, [lon, lat]] of ring.entries()) {
        expect(lon).toBe(Math.round(lon * 1e7) / 1e7);
        expect(lat).toBe(Math.round(lat * 1e7) / 1e7);
        if (i > 0) expect([lon, lat], `${field.name} point ${i}`).not.toEqual(ring[i - 1]);
      }
    }
  });

  it("lie inside the real fields they are cut from", () => {
    for (const placement of PLACEMENTS) {
      const field = fields.find((f) => f.name === placement.name)!;
      // Both measured the same way (Turf's), so they compare. Rounding to seven decimals moves an edge
      // by up to a centimeter, which over a field's whole outline is a few square meters at most.
      const inside = sharedSquareMeters(field.geometry, source(placement.csbId));
      const whole = sharedSquareMeters(field.geometry, field.geometry);
      expect(whole).toBeGreaterThan(100_000);
      expect(whole - inside, placement.name).toBeLessThan(40);
    }
  });

  it("share a fence line and no ground", () => {
    const [north80, south40] = fields;
    expect(sharedSquareMeters(north80.geometry, south40.geometry)).toBeLessThan(1);
    expect(edges(south40.geometry.coordinates[0]).north).toBe(42.0926232);
    expect(north80.geometry.coordinates[0].some(([, lat]) => lat === 42.0926232)).toBe(true);
  });
});

describe("how each field is cut", () => {
  it("North 80 keeps its real field's west, north and south edges and loses its east end", () => {
    const real = edges(source("191623001171158").coordinates[0]);
    const cut = edges(fields[0].geometry.coordinates[0]);
    expect(databaseAcres(source("191623001171158"))).toBe(80.41);
    for (const side of ["west", "north", "south"] as const) expect(cut[side]).toBeCloseTo(real[side], 6);
    expect(cut.east).toBeLessThan(real.east);
    // About 29 m: a degree of longitude is 82.6 km here.
    expect((real.east - cut.east) * 82_600).toBeGreaterThan(25);
    expect((real.east - cut.east) * 82_600).toBeLessThan(35);
  });

  it("South 40 is the north-west corner of its real field, stopped at the field line to the south", () => {
    const real = edges(source("191623001171261").coordinates[0]);
    const cut = edges(fields[1].geometry.coordinates[0]);
    expect(cut.west).toBeCloseTo(real.west, 6);
    expect(cut.north).toBeCloseTo(real.north, 6);
    expect(cut.south).toBe(42.089);
    expect(cut.east).toBeLessThan(real.east);
  });
});

describe("cutToAcres", () => {
  // A made-up field about 800 m by 400 m: close to 80 acres.
  const ring: LonLat[] = [[-93.42, 42.09], [-93.41, 42.09], [-93.41, 42.0936], [-93.42, 42.0936], [-93.42, 42.09]];
  const madeUp = { type: "Polygon" as const, coordinates: [ring] };

  it("moves the east edge until the database's measure reads the acres asked for", () => {
    const cut = cutToAcres(madeUp, { name: "Test", csbId: "x", acres: 50, southEdge: null });
    expect(databaseAcres(cut)).toBe(50);
    const cutEdges = edges(cut.coordinates[0]);
    expect(cutEdges).toMatchObject({ west: -93.42, south: 42.09, north: 42.0936 });
    expect(cutEdges.east).toBeGreaterThan(-93.42);
    expect(cutEdges.east).toBeLessThan(-93.41);
  });

  it("stops the outline at a south edge first when one is given", () => {
    const cut = cutToAcres(madeUp, { name: "Test", csbId: "x", acres: 20, southEdge: 42.092 });
    expect(databaseAcres(cut)).toBe(20);
    expect(edges(cut.coordinates[0]).south).toBe(42.092);
  });

  it("refuses a field that holds fewer acres than asked for, and one with a hole", () => {
    expect(() => cutToAcres(madeUp, { name: "Test", csbId: "x", acres: 500, southEdge: null })).toThrow(
      "Test's source outline holds fewer than 500 acres.",
    );
    const hole: LonLat[] = [[-93.416, 42.091], [-93.414, 42.091], [-93.414, 42.092], [-93.416, 42.092], [-93.416, 42.091]];
    expect(() =>
      cutToAcres({ type: "Polygon", coordinates: [ring, hole] }, { name: "Test", csbId: "x", acres: 50, southEdge: null }),
    ).toThrow("Test's source outline has a hole in it.");
  });

  it("says which field is missing from the clip", () => {
    expect(() => placeFields([])).toThrow("North 80's real field, CSB 191623001171158, is not in the clip.");
  });
});
