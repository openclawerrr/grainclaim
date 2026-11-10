/**
 * npm run fetch-naip: downloads the aerial photo the sample FSA map is printed
 * on, and writes down exactly what ground it covers.
 *
 *   sample-data/reference/naip-daves-farm.jpg    the photo
 *   sample-data/reference/naip-daves-farm.json   its year, flight strips and bounding box
 *
 * The photo is from USDA's National Agriculture Imagery Program (NAIP):
 * public domain, and the imagery FSA prints its own maps on. It covers Dave's
 * two fields plus a margin (see map-area.ts). Run this again after moving a
 * field; map-area.test.ts fails while the photo covers the wrong ground.
 *
 * It asks for the newest year the service has for this ground, and refuses to
 * save a photo it can't put one year on. It reads farm.geojson and writes the
 * two files: no database, no Claude.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { booleanPointInPolygon, point, polygon } from "@turf/turf";
import { loadSampleFiles } from "../seed/sample-files";
import { mapArea, NAIP_FACTS, NAIP_IMAGE, naipFactsSchema, type Bbox, type NaipFacts } from "./map-area";

const SERVICE = "https://imagery.geoplatform.gov/iipp/rest/services/NAIP/NAIP_plus/ImageServer";
/** In the service's catalog, 1 marks a flight strip and 2 a zoomed-out overview stitched from many. */
const FLIGHT_STRIP = 1;
const JPEG_QUALITY = 90;

interface CatalogRow {
  attributes: { name: string; year: number; category: number };
  geometry?: { rings: number[][][] };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  const body = (await response.json()) as { error?: { message?: string } };
  if (body.error) throw new Error(`"${body.error.message ?? "error"}" from ${url}`);
  return body;
}

/** The newest year with a flight strip over the area, and that year's strips. */
async function newestStrips(bbox: Bbox): Promise<{ year: number; strips: CatalogRow[] }> {
  const query = new URLSearchParams({
    geometry: bbox.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    where: `category = ${FLIGHT_STRIP}`,
    outFields: "name,year,category",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  const { features = [] } = (await getJson(`${SERVICE}/query?${query}`)) as { features?: CatalogRow[] };
  if (features.length === 0) throw new Error("The service has no aerial photo over Dave's fields.");
  const year = Math.max(...features.map((row) => row.attributes.year));
  return { year, strips: features.filter((row) => row.attributes.year === year) };
}

/** True if every corner of the area lies on one of the strips, so the photo is all from one year. */
function covers(strips: readonly CatalogRow[], [west, south, east, north]: Bbox): boolean {
  const corners = [[west, south], [east, south], [east, north], [west, north]];
  return corners.every((corner) =>
    strips.some((strip) => strip.geometry !== undefined && booleanPointInPolygon(point(corner), polygon(strip.geometry.rings))),
  );
}

async function main(): Promise<void> {
  const dir = path.resolve("sample-data");
  const area = mapArea(loadSampleFiles(dir).fields);
  const { year, strips } = await newestStrips(area.bbox);
  if (!covers(strips, area.bbox)) {
    throw new Error(`The ${year} photos don't cover the whole map area, so the photo would mix years. Nothing was saved.`);
  }

  const request = new URLSearchParams({
    bbox: area.bbox.join(","),
    bboxSR: "4326",
    imageSR: "4326",
    size: `${area.width},${area.height}`,
    // Keep exactly the area asked for. Left on, the service would add ground to make each pixel square in degrees.
    adjustAspectRatio: "false",
    format: "jpg",
    compressionQuality: String(JPEG_QUALITY),
    mosaicRule: JSON.stringify({ mosaicMethod: "esriMosaicNorthwest", where: `year = ${year} AND category = ${FLIGHT_STRIP}` }),
    f: "json",
  });
  const exported = (await getJson(`${SERVICE}/exportImage?${request}`)) as {
    href: string;
    width: number;
    height: number;
    extent: { xmin: number; ymin: number; xmax: number; ymax: number; spatialReference: { wkid: number } };
  };
  if (exported.extent.spatialReference.wkid !== 4326) throw new Error("The service answered in a different coordinate system.");

  const download = await fetch(exported.href, { signal: AbortSignal.timeout(120_000) });
  if (!download.ok) throw new Error(`${download.status} ${download.statusText} downloading the photo.`);
  const jpeg = Buffer.from(await download.arrayBuffer());
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("The service sent something that isn't a JPEG.");

  const facts: NaipFacts = naipFactsSchema.parse({
    note:
      "USDA National Agriculture Imagery Program (NAIP) aerial photo, public domain. The ground the sample FSA map is printed on. " +
      "Made by npm run fetch-naip; don't edit it by hand.",
    source: SERVICE,
    year,
    tiles: strips.map((strip) => strip.attributes.name).sort(),
    bbox: [exported.extent.xmin, exported.extent.ymin, exported.extent.xmax, exported.extent.ymax],
    width: exported.width,
    height: exported.height,
  });
  writeFileSync(path.join(dir, NAIP_IMAGE), jpeg);
  writeFileSync(path.join(dir, NAIP_FACTS), `${JSON.stringify(facts, null, 2)}\n`);
  console.log(`  sample-data/${NAIP_IMAGE}  (${facts.width} × ${facts.height} px, ${Math.round(jpeg.length / 1024)} KB)`);
  console.log(`  sample-data/${NAIP_FACTS}`);
  console.log(`Imagery year: ${year}, from ${facts.tiles.join(", ")}.`);
  console.log("Now run npm run print-docs: the map's credit line and its PDF depend on this photo.");
}

main().catch((err: unknown) => {
  console.error(`fetch-naip failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
