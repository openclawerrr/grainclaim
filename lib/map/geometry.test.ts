import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boundsOf, outlineCenter } from "./geometry";

const farm = JSON.parse(readFileSync(path.resolve("sample-data", "farm.geojson"), "utf8")) as {
  features: { properties: { name: string }; geometry: { coordinates: number[][][] } }[];
};

describe("outlineCenter", () => {
  it("is the middle of a rectangle, whichever way round it is drawn", () => {
    const ring = [[-93.42, 42.09], [-93.41, 42.09], [-93.41, 42.1], [-93.42, 42.1], [-93.42, 42.09]];
    const [lon, lat] = outlineCenter(ring);
    expect(lon).toBeCloseTo(-93.415, 9);
    expect(lat).toBeCloseTo(42.095, 9);
    const [lonBack, latBack] = outlineCenter([...ring].reverse());
    expect(lonBack).toBeCloseTo(-93.415, 9);
    expect(latBack).toBeCloseTo(42.095, 9);
  });

  it("sits in the body of an L-shaped field, not at the average of its corners", () => {
    // A 2 × 2 square with its top-right quarter missing.
    const ring = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]];
    const [x, y] = outlineCenter(ring);
    expect(x).toBeCloseTo(5 / 6, 9);
    expect(y).toBeCloseTo(5 / 6, 9);
  });

  it("puts each sample field's label inside its own outline's box", () => {
    for (const field of farm.features) {
      const ring = field.geometry.coordinates[0];
      const [[west, south], [east, north]] = boundsOf(ring)!;
      const [lon, lat] = outlineCenter(ring);
      expect(lon, field.properties.name).toBeGreaterThan(west);
      expect(lon).toBeLessThan(east);
      expect(lat).toBeGreaterThan(south);
      expect(lat).toBeLessThan(north);
    }
  });

  it("falls back to the average for a line or a point", () => {
    expect(outlineCenter([[0, 0], [2, 2], [0, 0]])).toEqual([1, 1]);
    expect(outlineCenter([[5, 7]])).toEqual([5, 7]);
  });
});

describe("boundsOf", () => {
  it("gives the south-west and north-east corners around some points", () => {
    expect(boundsOf([[-93.43, 42.093], [-93.415, 42.089], [-93.42, 42.096]])).toEqual([
      [-93.43, 42.089],
      [-93.415, 42.096],
    ]);
    expect(boundsOf([[1, 2]])).toEqual([[1, 2], [1, 2]]);
  });

  it("is null when there is nothing to show", () => {
    expect(boundsOf([])).toBeNull();
  });
});
