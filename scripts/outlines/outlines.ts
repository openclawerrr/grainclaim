/**
 * Builds sample-data/nearby-outlines.geojson: the field outlines Claude
 * chooses from when it pairs a photo of Dave's FSA map with outlines near
 * his farm. Pure: plain data in, plain data out.
 *
 * The file holds the two fields of Dave's made-up farm, copied from
 * farm.geojson point for point, and a few real neighbors from USDA NASS Crop
 * Sequence Boundaries (public domain). No outline carries a name or FSA numbers: the map photo
 * supplies those, and the outlines are what they get paired with.
 */
import {
  area,
  booleanIntersects,
  centroid,
  circle,
  distance,
  featureCollection,
  intersect,
  point,
  pointToPolygonDistance,
} from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { databaseAcres } from "./acres";

/** The acres Dave's two fields measure, which the FSA map prints. A neighbor must not come close to either. */
export const DAVES_ACRES = [80.2, 40] as const;
/** How far a neighbor's acres must be from each of Dave's fields, so the pairing has one right answer. */
export const MIN_ACRE_GAP = 5;
/** How many neighbors the file holds, at most. */
export const MAX_NEIGHBORS = 6;
export const MIN_NEIGHBORS = 4;
/** A neighbor is at least this many acres. The clip's smaller polygons are slivers and odd corners, not fields someone reports. */
export const MIN_NEIGHBOR_ACRES = 20;
/**
 * The farmstead is everything this close to a bin: the bins themselves and
 * the yard around them. Real bins stand within 30 m of the next field, so a
 * wider circle would rule out the fields a farmstead naturally sits beside.
 */
export const FARMSTEAD_RADIUS_M = 15;
/** Fixes the order of the outlines. Change it and the file changes. */
export const SHUFFLE_SEED = 2027;
/** Shared area below this is two outlines meeting along an edge, not overlapping. */
export const TOUCHING_M2 = 1;

export type LonLat = [number, number];

/** A field outline from farm.geojson: only what this file needs. */
export interface FarmField {
  id: string;
  geometry: { type: "Polygon"; coordinates: LonLat[][] };
}

/** One polygon from the Crop Sequence Boundaries clip. */
export interface CsbFeature {
  properties: { id: string; crop: string | null };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface NearbyOutline {
  type: "Feature";
  id: string;
  properties:
    | { id: string; source: "sample"; sample: true }
    | { id: string; crop: string; source: "public_csb"; sample: true };
  geometry: { type: "Polygon"; coordinates: LonLat[][] };
}

export interface NearbyOutlines {
  type: "FeatureCollection";
  name: string;
  sample: true;
  note: string;
  features: NearbyOutline[];
}

type PolygonLike = { type: "Polygon"; coordinates: number[][][] };
const asFeature = (geometry: PolygonLike): Feature<Polygon> => ({ type: "Feature", properties: {}, geometry });

/** Square meters two outlines share. Zero when they are apart or only touch. */
export function sharedSquareMeters(a: PolygonLike, b: PolygonLike): number {
  if (!booleanIntersects(asFeature(a), asFeature(b))) return 0;
  const shared = intersect(featureCollection([asFeature(a), asFeature(b)]));
  return shared ? area(shared) : 0;
}

/** Fields this close together border each other: a road and its ditches fit in the gap. */
export const BORDERING_M = 40;

/**
 * How far an outline is from the nearest of Dave's fields, in meters, counted
 * in steps of BORDERING_M so that every bordering field counts as equally close.
 */
export function gapMeters(candidate: PolygonLike, fields: readonly FarmField[]): number {
  let nearest = Infinity;
  for (const field of fields) {
    for (const [from, to] of [
      [candidate, field.geometry],
      [field.geometry, candidate],
    ] as const) {
      for (const [lon, lat] of from.coordinates[0]) {
        const away = pointToPolygonDistance(point([lon, lat]), asFeature(to), { units: "meters" });
        nearest = Math.min(nearest, Math.max(0, away));
      }
    }
  }
  return Math.floor(nearest / BORDERING_M) * BORDERING_M;
}

/** About a centimeter on the ground: finer than the outlines were drawn. */
const roundCoordinate = (n: number) => Math.round(n * 1e7) / 1e7;

/** An outline with every point rounded to seven decimals, as the file holds it. */
function rounded(geometry: PolygonLike): { type: "Polygon"; coordinates: LonLat[][] } {
  return {
    type: "Polygon",
    coordinates: geometry.coordinates.map((ring) =>
      ring.map(([lon, lat]): LonLat => [roundCoordinate(lon), roundCoordinate(lat)]),
    ),
  };
}

/** A small repeatable random-number generator (mulberry32), so the shuffle is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new array in a shuffled order that depends only on the seed. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = seededRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Why a polygon from the clip can't be a neighbor, or null if it can. */
export function whyNotANeighbor(
  candidate: CsbFeature,
  fields: readonly FarmField[],
  bins: readonly LonLat[],
): string | null {
  const { geometry, properties } = candidate;
  if (properties.crop === null || !CROP_FIELD.test(properties.crop)) return "it isn't a crop field";
  if (geometry.coordinates.length > 1) return "it has a hole in it";
  // Sharing an edge is fine: real neighbors do. Sharing ground is not. The comparison is made on the
  // outline as the file will hold it, so an edge shared with one of Dave's fields stays exactly shared.
  if (fields.some((field) => sharedSquareMeters(rounded(geometry), field.geometry) >= TOUCHING_M2)) {
    return "it overlaps one of Dave's fields";
  }
  const farmstead = bins.map((bin) => circle(bin, FARMSTEAD_RADIUS_M, { units: "meters", steps: 32 }));
  if (farmstead.some((yard) => booleanIntersects(asFeature(geometry), yard))) return "it overlaps the farmstead";
  const acres = databaseAcres(geometry);
  if (acres < MIN_NEIGHBOR_ACRES) return `its ${acres} acres are too small to be a field of its own`;
  if (DAVES_ACRES.some((daves) => Math.abs(acres - daves) < MIN_ACRE_GAP)) {
    return `its ${acres} acres are too close to one of Dave's fields`;
  }
  return null;
}

/** Crops that make a polygon a field. The clip also holds "Developed/Open Space", which is not one. */
const CROP_FIELD = /^(corn|soybeans|wheat|oats|alfalfa|sorghum|barley|rye|hay)/i;

/**
 * The outlines file: Dave's fields with farm.geojson's exact coordinates,
 * and the nearest polygons from the clip that can be neighbors, in a
 * shuffled order that never changes.
 */
export function buildNearbyOutlines(
  fields: readonly FarmField[],
  bins: readonly LonLat[],
  clip: readonly CsbFeature[],
): NearbyOutlines {
  const farmCenter = centroid(featureCollection(fields.map((field) => asFeature(field.geometry))));
  const neighbors = clip
    .filter((candidate) => whyNotANeighbor(candidate, fields, bins) === null)
    .map((candidate) => ({
      candidate,
      gap: gapMeters(candidate.geometry, fields),
      away: distance(farmCenter, centroid(asFeature(candidate.geometry))),
    }))
    // The fields that border Dave's come first, then the next nearest. Center to center settles fields that
    // are equally close, and the CSB id settles the rest, so the choice never depends on the clip's order.
    .sort(
      (a, b) => a.gap - b.gap || a.away - b.away || a.candidate.properties.id.localeCompare(b.candidate.properties.id),
    )
    .slice(0, MAX_NEIGHBORS)
    .map(({ candidate }) => candidate);
  if (neighbors.length < MIN_NEIGHBORS) {
    throw new Error(
      `Only ${neighbors.length} polygons in the CSB clip can be neighbors; the outlines file needs at least ${MIN_NEIGHBORS}.`,
    );
  }

  const features: NearbyOutline[] = [
    ...fields.map(
      (field): NearbyOutline => ({
        type: "Feature",
        id: field.id,
        properties: { id: field.id, source: "sample", sample: true },
        geometry: { type: "Polygon", coordinates: field.geometry.coordinates },
      }),
    ),
    ...neighbors.map(
      ({ properties, geometry }): NearbyOutline => ({
        type: "Feature",
        id: properties.id,
        properties: { id: properties.id, crop: properties.crop!, source: "public_csb", sample: true },
        geometry: rounded(geometry),
      }),
    ),
  ];

  return {
    type: "FeatureCollection",
    name: "Field outlines near Dave's Farm (SAMPLE)",
    sample: true,
    note:
      "SAMPLE: the outlines GrainClaim chooses from when it pairs a photo of Dave's FSA map with fields near his farm. " +
      "Two are the fields of Dave's made-up farm, with the same coordinates as farm.geojson (source: sample). " +
      "The rest are real crop-field outlines from USDA NASS Crop Sequence Boundaries, public domain (source: public_csb); " +
      "they are not Dave's and say nothing about who farms them. " +
      "No outline has a name or FSA numbers: the map photo supplies those. " +
      "Made by npm run build-outlines; don't edit it by hand.",
    features: shuffled(
      [...features].sort((a, b) => a.id.localeCompare(b.id)),
      SHUFFLE_SEED,
    ),
  };
}

/** The file's text: indented like farm.geojson, with each point on one line. */
export function serializeOutlines(outlines: NearbyOutlines): string {
  const text = JSON.stringify(outlines, null, 2).replace(
    /\[\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\]/g,
    "[$1, $2]",
  );
  return `${text}\n`;
}
