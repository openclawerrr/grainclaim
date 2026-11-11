/**
 * Small map geometry for the farm map screen: where to put a field's label
 * and what area a set of points covers. Pure, and safe in client components.
 * Points are [longitude, latitude].
 */

export type LonLat = [number, number];

/**
 * The middle of an outline, weighted by area, so the label sits in the body
 * of an odd-shaped field and not at the average of its corners. Over a field,
 * longitude and latitude are near enough to flat for this.
 */
export function outlineCenter(ring: readonly (readonly number[])[]): LonLat {
  let [area, x, y] = [0, 0, 0];
  // Measured from the first point: a field is tiny next to its longitude, and the sums would lose it.
  const [originX, originY] = ring[0];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = [ring[i][0] - originX, ring[i][1] - originY];
    const [x2, y2] = [ring[i + 1][0] - originX, ring[i + 1][1] - originY];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-18) {
    // A line or a single point: fall back to the plain average.
    const points = ring.length > 1 ? ring.slice(0, -1) : ring;
    return [avg(points.map((p) => p[0])), avg(points.map((p) => p[1]))];
  }
  return [originX + x / (3 * area), originY + y / (3 * area)];
}

const avg = (values: number[]) => values.reduce((total, v) => total + v, 0) / values.length;

/** [[west, south], [east, north]] around some points, or null when there are none. */
export function boundsOf(points: readonly (readonly number[])[]): [LonLat, LonLat] | null {
  if (points.length === 0) return null;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
