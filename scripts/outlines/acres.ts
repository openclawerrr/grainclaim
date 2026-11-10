/**
 * Acres inside an outline, measured the way the database measures them.
 *
 * The database stores `mapped_acres` as PostGIS's area of the outline on the
 * WGS 84 ellipsoid (`ST_Area(boundary::geography)`), divided by 4046.8564224
 * and rounded to two decimals. Turf's `area` treats the earth as a sphere and
 * comes out about 0.15% smaller here (80.08 acres for North 80's 80.20), which
 * is enough to fire a false acre-mismatch flag, so it is not used for acres.
 *
 * This measures on the same ellipsoid without the database: each point's
 * latitude is moved to the sphere that has the ellipsoid's area (its
 * "authalic" latitude), and the polygon is measured there with great-circle
 * edges. For field-sized outlines it agrees with DuckDB's `ST_Area_Spheroid`
 * to well under a square meter, and DuckDB gives the database's 80.20 and
 * 40.00 for the fields those figures were first measured on; acres.test.ts
 * holds this to DuckDB's figures.
 */

export const SQUARE_METERS_PER_ACRE = 4046.8564224;

/** WGS 84: the equatorial radius in meters, the flattening, and the eccentricity squared. */
export const A = 6378137;
const F = 1 / 298.257223563;
export const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const RADIANS = Math.PI / 180;

/** The ellipsoid's area between the equator and a latitude, per radian of longitude, without the constant factor. */
function q(sinLatitude: number): number {
  const es = E * sinLatitude;
  return (1 - E2) * (sinLatitude / (1 - es * es) - Math.log((1 - es) / (1 + es)) / (2 * E));
}
const Q_POLE = q(1);
/** The radius of the sphere with the same area as the ellipsoid: 6,371,007.18 m. */
const AUTHALIC_RADIUS = A * Math.sqrt(Q_POLE / 2);

/** tan(β / 2) for the authalic latitude β of a latitude in degrees. */
function tanHalfAuthalic(latitude: number): number {
  const sinBeta = q(Math.sin(latitude * RADIANS)) / Q_POLE;
  return sinBeta / (1 + Math.sqrt(1 - sinBeta * sinBeta));
}

/** Square meters inside one closed ring of [longitude, latitude] points. Never negative. */
function ringSquareMeters(ring: readonly (readonly number[])[]): number {
  let excess = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const [t1, t2] = [tanHalfAuthalic(lat1), tanHalfAuthalic(lat2)];
    const halfTurn = Math.tan(((lon2 - lon1) * RADIANS) / 2);
    // The area between this edge and the equator, as an angle (the spherical excess).
    excess += 2 * Math.atan2(halfTurn * (t1 + t2), 1 + t1 * t2);
  }
  return Math.abs(excess) * AUTHALIC_RADIUS * AUTHALIC_RADIUS;
}

/** Square meters inside a polygon on the WGS 84 ellipsoid: its outer ring less any holes. */
export function ellipsoidSquareMeters(geometry: { coordinates: readonly (readonly (readonly number[])[])[] }): number {
  const [outer, ...holes] = geometry.coordinates;
  return holes.reduce((left, hole) => left - ringSquareMeters(hole), ringSquareMeters(outer));
}

/** Acres as the database measures them, unrounded. */
export function exactAcres(geometry: { coordinates: readonly (readonly (readonly number[])[])[] }): number {
  return ellipsoidSquareMeters(geometry) / SQUARE_METERS_PER_ACRE;
}

/** Acres as the database stores them: rounded to two decimals. */
export function databaseAcres(geometry: { coordinates: readonly (readonly (readonly number[])[])[] }): number {
  return Math.round(exactAcres(geometry) * 100) / 100;
}
