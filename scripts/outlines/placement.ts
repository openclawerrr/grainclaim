/**
 * Where Dave's two made-up fields sit, and how their outlines were made.
 * Pure: plain data in, plain data out.
 *
 * The first sample fields were plain rectangles. Over the aerial photo they
 * covered a road intersection and a ditch, so they were moved onto real
 * ground, using outlines from USDA NASS Crop Sequence Boundaries (CSB):
 *
 * - North 80 is a real field of 80.41 acres, shortened at its east end until
 *   the database measures 80.20.
 * - South 40 is the north-west corner of the real 158-acre field directly
 *   south of it: a quarter-mile block whose north and west sides are that
 *   field's own edges and whose south side follows a field line visible in
 *   the photo, cut on the east where the database measures 40.00.
 *
 * farm.geojson holds the result: npm run place-fields writes it, and
 * placement.test.ts fails if the two ever differ. Acres are the database's
 * measure (acres.ts), never Turf's.
 */
import { bboxPolygon, intersect, featureCollection, rewind } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { databaseAcres, exactAcres } from "./acres";

export type LonLat = [number, number];
type PolygonLike = { type: "Polygon"; coordinates: number[][][] };

export interface FieldPlacement {
  /** The field's name in farm.geojson. */
  name: string;
  /** The CSB polygon the outline is cut from. */
  csbId: string;
  /** The acres the database must measure. */
  acres: number;
  /** A latitude the outline stops at on the south, or null to keep the whole polygon's depth. */
  southEdge: number | null;
}

export const PLACEMENTS: readonly FieldPlacement[] = [
  { name: "North 80", csbId: "191623001171158", acres: 80.2, southEdge: null },
  // 42.0890 is the east-west field line visible in the 2023 aerial photo, a quarter mile south of the north edge.
  { name: "South 40", csbId: "191623001171261", acres: 40, southEdge: 42.089 },
];

/**
 * How far the measured acres may sit from the target. The database rounds to
 * 0.01, so anything within 0.005 would do; this keeps well inside that. One
 * step of the east edge (a centimeter) moves a 40-acre block by 0.0008 acres.
 */
const ACRE_TOLERANCE = 0.001;

/** About a centimeter on the ground. */
const roundCoordinate = (n: number) => Math.round(n * 1e7) / 1e7;

/** The part of a one-ring polygon west of a longitude and north of a latitude, as one ring. */
function keep(geometry: PolygonLike, eastEdge: number, southEdge: number | null): LonLat[] {
  const [west, south, north] = [-180, southEdge ?? -90, 90];
  const kept = intersect(
    featureCollection<Polygon>([
      { type: "Feature", properties: {}, geometry: geometry as Polygon },
      bboxPolygon([west, south, eastEdge, north]),
    ]),
  );
  if (!kept || kept.geometry.type !== "Polygon" || kept.geometry.coordinates.length !== 1) {
    throw new Error("Cutting the outline left no ground, more than one piece, or a hole.");
  }
  const counterclockwise = rewind(kept as Feature<Polygon>) as Feature<Polygon>;
  const ring = counterclockwise.geometry.coordinates[0].map(
    ([lon, lat]): LonLat => [roundCoordinate(lon), roundCoordinate(lat)],
  );
  // Rounding can land two neighboring points on the same spot; keep one.
  return ring.filter((point, i) => i === 0 || point[0] !== ring[i - 1][0] || point[1] !== ring[i - 1][1]);
}

/**
 * Cuts a real field's outline down to an exact number of acres by moving its
 * east edge west, after first stopping it at `southEdge` if one is given.
 * The acres are the database's measure (see acres.ts).
 */
export function cutToAcres(source: PolygonLike, placement: FieldPlacement): { type: "Polygon"; coordinates: LonLat[][] } {
  if (source.coordinates.length !== 1) throw new Error(`${placement.name}'s source outline has a hole in it.`);
  const longitudes = source.coordinates[0].map(([lon]) => lon);
  let [low, high] = [Math.min(...longitudes), Math.max(...longitudes)];
  const acresWest = (eastEdge: number) =>
    exactAcres({ coordinates: [keep(source, eastEdge, placement.southEdge)] });
  if (acresWest(high) < placement.acres) {
    throw new Error(`${placement.name}'s source outline holds fewer than ${placement.acres} acres.`);
  }
  // Moving the east edge east only ever adds ground, so halving the gap finds the edge.
  for (let i = 0; i < 60; i++) {
    const middle = (low + high) / 2;
    if (acresWest(middle) < placement.acres) low = middle;
    else high = middle;
  }
  // The edge is stored to seven decimals. Of the two such longitudes either side of it, take the closer fit.
  const [justWest, justEast] = [Math.floor(high * 1e7) / 1e7, Math.ceil(high * 1e7) / 1e7];
  const eastEdge =
    Math.abs(acresWest(justWest) - placement.acres) <= Math.abs(acresWest(justEast) - placement.acres) ? justWest : justEast;
  const geometry = { type: "Polygon" as const, coordinates: [keep(source, eastEdge, placement.southEdge)] };
  const measured = exactAcres(geometry);
  if (databaseAcres(geometry) !== placement.acres || Math.abs(measured - placement.acres) > ACRE_TOLERANCE) {
    throw new Error(`${placement.name} came out at ${measured.toFixed(5)} acres, not ${placement.acres}.`);
  }
  return geometry;
}

/** Each field's outline, cut from its real field in the CSB clip. */
export function placeFields(
  clip: readonly { properties: { id: string }; geometry: PolygonLike }[],
): { name: string; geometry: { type: "Polygon"; coordinates: LonLat[][] } }[] {
  return PLACEMENTS.map((placement) => {
    const source = clip.find((c) => c.properties.id === placement.csbId);
    if (!source) throw new Error(`${placement.name}'s real field, CSB ${placement.csbId}, is not in the clip.`);
    return { name: placement.name, geometry: cutToAcres(source.geometry, placement) };
  });
}
