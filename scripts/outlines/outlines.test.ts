import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { databaseAcres } from "./acres";
import { buildOutlineFiles, loadOutlineInputs, OUTLINES_FILE, PREVIEW_FILE } from "./files";
import {
  BORDERING_M,
  buildNearbyOutlines,
  DAVES_ACRES,
  FARMSTEAD_RADIUS_M,
  gapMeters,
  MAX_NEIGHBORS,
  MIN_ACRE_GAP,
  MIN_NEIGHBOR_ACRES,
  MIN_NEIGHBORS,
  serializeOutlines,
  sharedSquareMeters,
  shuffled,
  TOUCHING_M2,
  whyNotANeighbor,
  type CsbFeature,
  type FarmField,
  type LonLat,
  type NearbyOutlines,
} from "./outlines";
import { PLACEMENTS } from "./placement";
import { previewLabels, renderPreview } from "./preview";

const SAMPLE_DIR = path.resolve("sample-data");
const inputs = loadOutlineInputs();
const committed = (name: string) => readFileSync(path.join(SAMPLE_DIR, name), "utf8");
const file = JSON.parse(committed(OUTLINES_FILE)) as NearbyOutlines;
const daves = file.features.filter((f) => f.properties.source === "sample");
const neighbors = file.features.filter((f) => f.properties.source === "public_csb");

// Made-up shapes for the rules, near Dave's Farm. One degree is about 82.6 km east-west and 111.1 km north-south here.
const M_LON = 1 / 82_600;
const M_LAT = 1 / 111_100;
const seven = (n: number) => Math.round(n * 1e7) / 1e7;
/** A rectangle with its south-west corner at a point, so many meters wide and tall, stored to seven decimals like farm.geojson. */
function rectangle([lon, lat]: LonLat, widthM: number, heightM: number): LonLat[] {
  const [west, south, east, north] = [lon, lat, lon + widthM * M_LON, lat + heightM * M_LAT].map(seven);
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}
const field = (id: string, ring: LonLat[]): FarmField => ({ id, geometry: { type: "Polygon", coordinates: [ring] } });
const csb = (id: string, ring: LonLat[], crop: string | null = "Corn", hole?: LonLat[]): CsbFeature => ({
  properties: { id, crop },
  geometry: { type: "Polygon", coordinates: hole ? [ring, hole] : [ring] },
});
const HOME = field("home", rectangle([-93.41, 42.09], 400, 400));
const BIN: LonLat = [-93.4, 42.09];
/** A 22-acre square (300 m a side) with its corner so many meters east and north of HOME's corner. */
const square22 = (id: string, eastM: number, northM: number) =>
  csb(id, rectangle([-93.41 + eastM * M_LON, 42.09 + northM * M_LAT], 300, 300));

describe("the committed outlines file", () => {
  it("says SAMPLE and where the outlines come from", () => {
    expect(file.sample).toBe(true);
    expect(file.name).toContain("(SAMPLE)");
    expect(file.note).toMatch(/^SAMPLE: /);
    expect(file.note).toContain("USDA NASS Crop Sequence Boundaries, public domain");
  });

  it("holds Dave's two fields with exactly farm.geojson's coordinates", () => {
    expect(daves).toHaveLength(2);
    for (const farmField of inputs.fields) {
      const outline = daves.find((f) => f.id === farmField.id);
      expect(outline, farmField.name).toBeDefined();
      expect(outline!.geometry).toEqual(farmField.geometry);
    }
  });

  it("gives Dave's fields an id and nothing that names them or carries FSA numbers", () => {
    for (const outline of daves) {
      expect(outline.properties).toEqual({ id: outline.id, source: "sample", sample: true });
    }
    const text = committed(OUTLINES_FILE);
    for (const hint of ["North 80", "South 40", "fsa_", "expected_acres", "tract"]) expect(text).not.toContain(hint);
  });

  it(`holds ${MIN_NEIGHBORS} to ${MAX_NEIGHBORS} neighbors, each a polygon from the clip with its CSB id and crop`, () => {
    expect(neighbors.length).toBeGreaterThanOrEqual(MIN_NEIGHBORS);
    expect(neighbors.length).toBeLessThanOrEqual(MAX_NEIGHBORS);
    for (const outline of neighbors) {
      expect(Object.keys(outline.properties).sort()).toEqual(["crop", "id", "sample", "source"]);
      expect(outline.properties).toMatchObject({ id: outline.id, sample: true });
      const source = inputs.clip.find((c) => c.properties.id === outline.id);
      expect(source, outline.id).toBeDefined();
      expect(source!.properties.crop).toBe((outline.properties as { crop: string }).crop);
      // The same shape as in the clip, to within the rounding (about a centimeter).
      expect(outline.geometry.coordinates[0]).toHaveLength(source!.geometry.coordinates[0].length);
      expect(Math.abs(databaseAcres(outline.geometry) - databaseAcres(source!.geometry))).toBeLessThanOrEqual(0.01);
    }
  });

  it(`holds no neighbor under ${MIN_NEIGHBOR_ACRES} acres, and neither of the real fields Dave's are cut from`, () => {
    for (const outline of neighbors) {
      expect(databaseAcres(outline.geometry), outline.id).toBeGreaterThanOrEqual(MIN_NEIGHBOR_ACRES);
    }
    const ids = neighbors.map((outline) => outline.id);
    for (const placement of PLACEMENTS) expect(ids, placement.name).not.toContain(placement.csbId);
  });

  it("takes the fields that border Dave's before any that don't", () => {
    const fields = inputs.fields;
    const gaps = neighbors.map((outline) => gapMeters(outline.geometry, fields));
    const bordering = inputs.clip.filter(
      (c) => whyNotANeighbor(c, fields, inputs.bins.map((b) => b.location)) === null && gapMeters(c.geometry, fields) === 0,
    );
    expect(bordering.length).toBeGreaterThan(0);
    expect(gaps.filter((gap) => gap === 0)).toHaveLength(Math.min(bordering.length, MAX_NEIGHBORS));
  });

  it("has no two outlines that overlap", () => {
    const outlines = file.features;
    for (let i = 0; i < outlines.length; i++) {
      for (let j = i + 1; j < outlines.length; j++) {
        const shared = sharedSquareMeters(outlines[i].geometry, outlines[j].geometry);
        expect(shared, `${outlines[i].id} and ${outlines[j].id}`).toBeLessThan(TOUCHING_M2);
      }
    }
  });

  it("keeps every neighbor off the farmstead", () => {
    for (const outline of neighbors) {
      const asClip: CsbFeature = { properties: { id: outline.id, crop: "Corn" }, geometry: outline.geometry };
      expect(whyNotANeighbor(asClip, [], inputs.bins.map((b) => b.location)), outline.id).toBeNull();
    }
  });

  it(`keeps every neighbor's acres at least ${MIN_ACRE_GAP} away from 80.20 and 40.00`, () => {
    expect(DAVES_ACRES).toEqual(inputs.fields.map((f) => f.expected_acres));
    for (const outline of neighbors) {
      const acres = databaseAcres(outline.geometry);
      for (const davesAcres of DAVES_ACRES) {
        expect(Math.abs(acres - davesAcres), `${outline.id} at ${acres} acres`).toBeGreaterThanOrEqual(MIN_ACRE_GAP);
      }
      // And from Dave's outlines as measured, which is the same thing while placement.test.ts passes.
      for (const outlineOfDaves of daves) {
        expect(Math.abs(acres - databaseAcres(outlineOfDaves.geometry))).toBeGreaterThanOrEqual(MIN_ACRE_GAP);
      }
    }
  });

  it("doesn't put Dave's fields first", () => {
    expect(file.features[0].properties.source).toBe("public_csb");
  });

  it("is up to date with farm.geojson, farm.json and the clip, and so is the preview", () => {
    const built = buildOutlineFiles(inputs);
    expect(committed(OUTLINES_FILE) === built[OUTLINES_FILE], "nearby-outlines.geojson is out of date: run npm run build-outlines").toBe(true);
    expect(committed(PREVIEW_FILE) === built[PREVIEW_FILE], "outlines-preview.html is out of date: run npm run build-outlines").toBe(true);
  });
});

describe("measuring", () => {
  it("measures what two outlines share, and nothing when they only touch or sit apart", () => {
    const a = rectangle([-93.41, 42.09], 400, 400);
    const overlapping = rectangle([-93.41 + 300 * M_LON, 42.09], 400, 400);
    const touching = rectangle([a[1][0], 42.09], 400, 400);
    const apart = rectangle([-93.39, 42.09], 400, 400);
    const shared = sharedSquareMeters(field("a", a).geometry, field("b", overlapping).geometry);
    expect(shared).toBeGreaterThan(39_000);
    expect(shared).toBeLessThan(41_000);
    expect(sharedSquareMeters(field("a", a).geometry, field("c", touching).geometry)).toBeLessThan(TOUCHING_M2);
    expect(sharedSquareMeters(field("a", a).geometry, field("d", apart).geometry)).toBe(0);
  });

  it(`counts the gap to Dave's nearest field in steps of ${BORDERING_M} m, so a field across the road borders too`, () => {
    const gap = (eastM: number) => gapMeters(square22("x", eastM, 0).geometry, [HOME]);
    expect(gap(400)).toBe(0); // shares HOME's east edge
    expect(gap(430)).toBe(0); // a road's width away
    expect(gap(500)).toBe(80);
    expect(gap(1300)).toBe(880);
  });
});

describe("whyNotANeighbor", () => {
  const reason = (candidate: CsbFeature) => whyNotANeighbor(candidate, [HOME], [BIN]);

  it("takes a crop field that is clear of Dave's fields and the farmstead", () => {
    expect(reason(square22("ok", 900, 900))).toBeNull();
    expect(reason(csb("beans", square22("x", 900, 900).geometry.coordinates[0] as LonLat[], "Soybeans"))).toBeNull();
  });

  it("leaves out a polygon that shares ground with one of Dave's fields, and takes one that only shares an edge", () => {
    expect(reason(square22("over", 200, 200))).toBe("it overlaps one of Dave's fields");
    expect(reason(square22("edge", 400, 0))).toBeNull();
  });

  it("compares the outline as the file will hold it, so a shared edge drawn finer than a centimeter still only touches", () => {
    const fine = square22("fine", 400, 0);
    fine.geometry.coordinates[0] = fine.geometry.coordinates[0].map(([lon, lat]) => [lon - 4e-8, lat]);
    expect(reason(fine)).toBeNull();
  });

  it("leaves out a polygon within reach of a bin", () => {
    const [binEastM, justOutside] = [(BIN[0] + 93.41) / M_LON, FARMSTEAD_RADIUS_M + 20];
    expect(reason(square22("yard", binEastM + FARMSTEAD_RADIUS_M - 20, 0))).toBe("it overlaps the farmstead");
    expect(reason(square22("clear", binEastM + justOutside, 0))).toBeNull();
  });

  it("leaves out a polygon whose acres are close to 80.20 or 40.00", () => {
    const acres = (target: number) => {
      const side = Math.sqrt(target * 4046.8564224);
      return csb("close", rectangle([-93.41 + 900 * M_LON, 42.09 + 900 * M_LAT], side, side));
    };
    expect(reason(acres(42))).toMatch(/^its 4\d\.\d+ acres are too close to one of Dave's fields$/);
    expect(reason(acres(78))).toMatch(/too close to one of Dave's fields$/);
    expect(reason(acres(60))).toBeNull();
    expect(reason(acres(90))).toBeNull();
  });

  it("leaves out slivers, polygons with a hole, and land that isn't a crop field", () => {
    const sliver = csb("sliver", rectangle([-93.41 + 900 * M_LON, 42.09 + 900 * M_LAT], 100, 100));
    expect(reason(sliver)).toMatch(/too small to be a field of its own$/);
    expect(databaseAcres(sliver.geometry)).toBeLessThan(MIN_NEIGHBOR_ACRES);
    const nearlyAField = csb("small", rectangle([-93.41 + 900 * M_LON, 42.09 + 900 * M_LAT], 280, 280));
    expect(reason(nearlyAField)).toMatch(/^its 19\.\d+ acres are too small to be a field of its own$/);

    const outer = square22("x", 900, 900).geometry.coordinates[0] as LonLat[];
    const hole = rectangle([outer[0][0] + 100 * M_LON, outer[0][1] + 100 * M_LAT], 50, 50);
    expect(reason(csb("holed", outer, "Corn", hole))).toBe("it has a hole in it");
    expect(reason(csb("town", outer, "Developed/Open Space"))).toBe("it isn't a crop field");
    expect(reason(csb("unknown", outer, null))).toBe("it isn't a crop field");
  });
});

describe("buildNearbyOutlines", () => {
  // Eight good candidates in a row to the north, each farther east than the last.
  const candidates = Array.from({ length: 8 }, (_, i) => square22(`csb-${i}`, 900 + i * 400, 900));

  it("takes the nearest neighbors, up to the most the file holds", () => {
    const built = buildNearbyOutlines([HOME], [BIN], candidates);
    const ids = built.features.filter((f) => f.properties.source === "public_csb").map((f) => f.id);
    expect(ids.sort()).toEqual(["csb-0", "csb-1", "csb-2", "csb-3", "csb-4", "csb-5"]);
    expect(built.features).toHaveLength(7);
  });

  it("takes a field that borders Dave's before a nearer one that doesn't", () => {
    // A long field along HOME's north edge, whose center is farther off than the first square's.
    const bordering = csb("long", rectangle([-93.41, 42.09 + 400 * M_LAT], 3000, 100));
    const built = buildNearbyOutlines([HOME], [BIN], [...candidates, bordering]);
    const ids = built.features.filter((f) => f.properties.source === "public_csb").map((f) => f.id);
    expect(ids).toContain("long");
    expect(ids).not.toContain("csb-5");
  });

  it("builds the same file whatever order the clip is in", () => {
    const forward = serializeOutlines(buildNearbyOutlines([HOME], [BIN], candidates));
    const backward = serializeOutlines(buildNearbyOutlines([HOME], [BIN], [...candidates].reverse()));
    expect(backward).toBe(forward);
  });

  it("refuses to build with too few neighbors", () => {
    expect(() => buildNearbyOutlines([HOME], [BIN], candidates.slice(0, 3))).toThrow(
      "Only 3 polygons in the CSB clip can be neighbors; the outlines file needs at least 4.",
    );
  });

  it("copies a field's coordinates untouched and rounds a neighbor's to seven decimals", () => {
    const fine = csb("fine", (square22("x", 900, 900).geometry.coordinates[0] as LonLat[]).map(([lon, lat]): LonLat => [lon + 1.23e-9, lat]));
    const built = buildNearbyOutlines([HOME], [BIN], [fine, ...candidates.slice(1, 4)]);
    expect(built.features.find((f) => f.id === "home")!.geometry.coordinates).toBe(HOME.geometry.coordinates);
    for (const [lon, lat] of built.features.find((f) => f.id === "fine")!.geometry.coordinates[0]) {
      expect(lon).toBe(Math.round(lon * 1e7) / 1e7);
      expect(lat).toBe(Math.round(lat * 1e7) / 1e7);
    }
  });
});

describe("shuffled", () => {
  it("gives the same order for the same seed, with every item kept", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(shuffled(items, 7)).toEqual(shuffled(items, 7));
    expect(shuffled(items, 7)).not.toEqual(shuffled(items, 8));
    expect([...shuffled(items, 7)].sort()).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });
});

describe("serializeOutlines", () => {
  it("writes each point on one line and reads back the same", () => {
    const built = buildOutlineFiles(inputs)[OUTLINES_FILE];
    expect(built).toContain("            [-93.4252888, 42.0926232],\n");
    expect(built.endsWith("}\n")).toBe(true);
    expect(JSON.parse(built)).toEqual(file);
  });
});

describe("the preview page", () => {
  const page = committed(PREVIEW_FILE);

  it("labels Dave's fields by name with the database's acres, and neighbors by CSB id with measured acres", () => {
    const labels = previewLabels({ outlines: file, fields: inputs.fields });
    expect(labels).toHaveLength(file.features.length);
    expect(labels.find((l) => l.title === "North 80")!.detail).toBe("80.20 ac");
    expect(labels.find((l) => l.title === "South 40")!.detail).toBe("40.00 ac");
    for (const outline of neighbors) {
      const label = labels.find((l) => l.id === outline.id)!;
      expect(label.title).toBe(`CSB ${outline.id}`);
      expect(label.detail).toMatch(/^\d+\.\d\d ac, [a-z]+$/);
    }
  });

  it("says so when an outline doesn't measure the acres farm.geojson expects", () => {
    const wrong = inputs.fields.map((f) => (f.name === "North 80" ? { ...f, expected_acres: 81 } : f));
    const labels = previewLabels({ outlines: file, fields: wrong });
    expect(labels.find((l) => l.title === "North 80")!.detail).toBe("80.20 ac, but farm.geojson expects 81.00");
  });

  it("carries the outlines inside the page, so it opens without a server", () => {
    expect(page).toContain('<script type="application/json" id="data">');
    for (const outline of file.features) expect(page).toContain(outline.id);
    expect(page).not.toMatch(/fetch\(|\.geojson"/);
  });

  it("says SAMPLE, credits the imagery, and shows it over Esri World Imagery", () => {
    expect(page).toContain("<title>Outlines preview (SAMPLE)</title>");
    expect(page).toContain("World_Imagery/MapServer/tile");
    expect(page).toContain("Imagery: Esri");
  });

  it("refuses an outline marked sample that isn't a field in farm.geojson", () => {
    const stray: NearbyOutlines = {
      ...file,
      features: [{ ...daves[0], id: "stray", properties: { id: "stray", source: "sample", sample: true } }],
    };
    expect(() => renderPreview({ outlines: stray, fields: inputs.fields, bins: inputs.bins, clip: inputs.clip })).toThrow(
      "Outline stray is marked sample but is not a field in farm.geojson.",
    );
  });
});
