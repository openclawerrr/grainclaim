import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSampleFiles } from "../seed/sample-files";
import {
  groundSize,
  MAP_ASPECT,
  MAP_MARGIN_M,
  MAP_WIDTH_PX,
  mapArea,
  metersPerDegree,
  NAIP_FACTS,
  NAIP_IMAGE,
  naipFactsSchema,
} from "./map-area";

const SAMPLE_DIR = path.resolve("sample-data");
const { fields } = loadSampleFiles();
const area = mapArea(fields);
const facts = naipFactsSchema.parse(JSON.parse(readFileSync(path.join(SAMPLE_DIR, NAIP_FACTS), "utf8")));
const rectangle = (west: number, south: number, east: number, north: number) => ({
  geometry: { coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
});

/** A baseline JPEG's width and height, from its start-of-frame marker. */
function jpegSize(jpeg: Buffer): { width: number; height: number } {
  const at = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  if (at === -1) throw new Error("not a baseline JPEG");
  return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) };
}

describe("metersPerDegree", () => {
  it("gives the WGS 84 figures at the equator and at Dave's Farm", () => {
    expect(metersPerDegree(0).lon).toBeCloseTo(111_319.49, 1);
    expect(metersPerDegree(0).lat).toBeCloseTo(110_574.28, 1);
    // The usual series for the length of a degree gives 82,733.5 m and 111,075.0 m at 42.09° north.
    const here = metersPerDegree(42.09);
    expect(Math.abs(here.lon - 82_733.5)).toBeLessThan(1);
    expect(Math.abs(here.lat - 111_075)).toBeLessThan(1);
  });
});

describe("mapArea", () => {
  const [west, south, east, north] = area.bbox;
  const points = fields.flatMap((f) => f.geometry.coordinates[0]);
  const meters = metersPerDegree((south + north) / 2);

  it(`leaves at least ${MAP_MARGIN_M} m of ground around Dave's two fields`, () => {
    const margins = {
      west: (Math.min(...points.map(([lon]) => lon)) - west) * meters.lon,
      east: (east - Math.max(...points.map(([lon]) => lon))) * meters.lon,
      south: (Math.min(...points.map(([, lat]) => lat)) - south) * meters.lat,
      north: (north - Math.max(...points.map(([, lat]) => lat))) * meters.lat,
    };
    for (const [side, margin] of Object.entries(margins)) expect(margin, side).toBeGreaterThanOrEqual(MAP_MARGIN_M - 0.2);
    // The fields are about as tall as they are wide, so the height sets the area and the width gets the extra.
    expect(margins.south).toBeLessThan(MAP_MARGIN_M + 0.2);
    expect(margins.north).toBeLessThan(MAP_MARGIN_M + 0.2);
    expect(Math.abs(margins.west - margins.east)).toBeLessThan(0.2);
  });

  it("has the shape of the map's frame, on the ground and in pixels", () => {
    const ground = groundSize(area.bbox);
    expect(ground.width / ground.height).toBeCloseTo(MAP_ASPECT, 3);
    expect([area.width, area.height]).toEqual([MAP_WIDTH_PX, 1143]);
    // About a meter of ground per pixel.
    expect(ground.width / area.width).toBeGreaterThan(0.9);
    expect(ground.width / area.width).toBeLessThan(1.1);
  });

  it("gets its extra ground in height when the fields are wide", () => {
    const wide = mapArea([rectangle(-93.44, 42.09, -93.41, 42.093)]);
    const ground = groundSize(wide.bbox);
    expect(ground.width / ground.height).toBeCloseTo(MAP_ASPECT, 3);
    expect((wide.bbox[0] - -93.44) * -metersPerDegree(42.0915).lon).toBeCloseTo(MAP_MARGIN_M, 0);
  });

  it("refuses to map no fields", () => {
    expect(() => mapArea([])).toThrow("There are no fields to put on the map.");
  });
});

describe("the aerial photo in sample-data/reference", () => {
  it("covers exactly the map area, so it is up to date with farm.geojson", () => {
    const stale = "naip-daves-farm.jpg covers the wrong ground: run npm run fetch-naip, then npm run print-docs";
    facts.bbox.forEach((edge, i) => expect(Math.abs(edge - area.bbox[i]), stale).toBeLessThan(1e-9));
    expect([facts.width, facts.height], stale).toEqual([area.width, area.height]);
  });

  it("is a JPEG of the size its facts file says", () => {
    const jpeg = readFileSync(path.join(SAMPLE_DIR, NAIP_IMAGE));
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
    expect(jpegSize(jpeg)).toEqual({ width: facts.width, height: facts.height });
  });

  it("is NAIP imagery from one year, credited as public domain", () => {
    expect(facts.source).toBe("https://imagery.geoplatform.gov/iipp/rest/services/NAIP/NAIP_plus/ImageServer");
    expect(facts.note).toContain("National Agriculture Imagery Program (NAIP)");
    expect(facts.note).toContain("public domain");
    // A flight strip's name carries the date it was flown: m_4209361_ne_15_030_20230830_20240104.
    for (const tile of facts.tiles) expect(tile).toMatch(new RegExp(`_${facts.year}\\d{4}_\\d{8}$`));
  });
});
