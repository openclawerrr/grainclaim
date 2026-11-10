/**
 * Reads what the FSA map is drawn from besides its values: the aerial photo
 * (sample-data/reference/naip-daves-farm.jpg), the ground that photo covers
 * (naip-daves-farm.json), and the field outlines in farm.geojson.
 *
 * The photo comes from npm run fetch-naip. The outlines are drawn straight
 * from farm.geojson onto the photo's bounding box, so the printed map can't
 * drift from the outlines GrainClaim pairs it with.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { NAIP_FACTS, NAIP_IMAGE, naipFactsSchema, type Bbox } from "../outlines/map-area";
import type { FieldFeature } from "../seed/sample-files";

export interface MapImage {
  /** The photo as a data: URI, so the page carries it and needs no file beside it. */
  dataUri: string;
  /** The ground the photo covers: [west, south, east, north]. */
  bbox: Bbox;
  /** The year the photo was flown. */
  year: number;
}

export interface MapInputs {
  image: MapImage;
  /** Every field in farm.geojson. */
  fields: readonly FieldFeature[];
}

export function loadMapInputs(fields: readonly FieldFeature[], dir = path.resolve("sample-data")): MapInputs {
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, NAIP_FACTS), "utf8"));
  const facts = naipFactsSchema.safeParse(raw);
  if (!facts.success) {
    throw new Error(`sample-data/${NAIP_FACTS} is not valid; run npm run fetch-naip:\n${z.prettifyError(facts.error)}`);
  }
  const jpeg = readFileSync(path.join(dir, NAIP_IMAGE));
  return {
    image: {
      dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      bbox: facts.data.bbox,
      year: facts.data.year,
    },
    fields,
  };
}
