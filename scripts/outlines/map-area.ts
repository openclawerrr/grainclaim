/**
 * The ground the printed FSA map shows, and the file that says which aerial
 * photo covers it. Pure: plain data in, plain data out. fetch-naip.ts
 * downloads the photo for this area; scripts/print draws the map on it.
 *
 * The area is Dave's two fields plus a margin, widened to the shape of the
 * map's frame on the page. It doesn't depend on the neighbors, so re-picking
 * them never moves the map.
 */
import { z } from "zod";
import { A, E2 } from "./acres";

/** Ground shown beyond the fields' outermost points, in meters. */
export const MAP_MARGIN_M = 150;
/** The map's width divided by its height, on the ground and on the page. */
export const MAP_ASPECT = 1.4;
/** The aerial photo's width in pixels: about a meter of ground per pixel, and over 200 pixels per printed inch. */
export const MAP_WIDTH_PX = 1600;

export const NAIP_IMAGE = "reference/naip-daves-farm.jpg";
export const NAIP_FACTS = "reference/naip-daves-farm.json";

/** [west, south, east, north], in degrees. */
export type Bbox = [number, number, number, number];

/** How many meters one degree of longitude and of latitude cover at a latitude, on the WGS 84 ellipsoid. */
export function metersPerDegree(latitude: number): { lon: number; lat: number } {
  const radians = Math.PI / 180;
  const sin = Math.sin(latitude * radians);
  const w = Math.sqrt(1 - E2 * sin * sin);
  return {
    lon: (A / w) * Math.cos(latitude * radians) * radians,
    lat: ((A * (1 - E2)) / (w * w * w)) * radians,
  };
}

/** A tenth of a meter on the ground: fine enough for a map, and short enough to read in a file. */
const sixPlaces = (n: number) => Math.round(n * 1e6) / 1e6;

export interface MapArea {
  bbox: Bbox;
  /** The photo's size in pixels. */
  width: number;
  height: number;
}

/** The area the map shows: the fields, the margin around them, and whatever more the frame's shape needs. */
export function mapArea(fields: readonly { geometry: { coordinates: readonly (readonly (readonly number[])[])[] } }[]): MapArea {
  const points = fields.flatMap((field) => field.geometry.coordinates[0]);
  if (points.length === 0) throw new Error("There are no fields to put on the map.");
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const center = { lon: (west + east) / 2, lat: (south + north) / 2 };
  const meters = metersPerDegree(center.lat);

  let widthM = (east - west) * meters.lon + 2 * MAP_MARGIN_M;
  let heightM = (north - south) * meters.lat + 2 * MAP_MARGIN_M;
  if (widthM / heightM < MAP_ASPECT) widthM = heightM * MAP_ASPECT;
  else heightM = widthM / MAP_ASPECT;

  const [halfLon, halfLat] = [widthM / 2 / meters.lon, heightM / 2 / meters.lat];
  return {
    bbox: [center.lon - halfLon, center.lat - halfLat, center.lon + halfLon, center.lat + halfLat].map(sixPlaces) as Bbox,
    width: MAP_WIDTH_PX,
    height: Math.round(MAP_WIDTH_PX / MAP_ASPECT),
  };
}

/** A bounding box's width and height on the ground, in meters. */
export function groundSize([west, south, east, north]: Bbox): { width: number; height: number } {
  const meters = metersPerDegree((south + north) / 2);
  return { width: (east - west) * meters.lon, height: (north - south) * meters.lat };
}

/** naip-daves-farm.json: what the aerial photo is and exactly what ground it covers. */
export const naipFactsSchema = z.object({
  note: z.string().min(1),
  /** The image service the photo came from. */
  source: z.url(),
  /** The year the photo was flown, which the map's credit line prints. */
  year: z.number().int().min(2000).max(2100),
  /** The service's names for the flight strips the photo is cut from. Each ends with the date flown and the date published. */
  tiles: z.array(z.string().min(1)).min(1),
  /** The ground the photo covers, as the service reported it. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type NaipFacts = z.infer<typeof naipFactsSchema>;
