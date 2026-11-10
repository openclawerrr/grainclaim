/**
 * Reads the files the outlines are built from, and says where the built
 * files go. The build itself (outlines.ts, preview.ts) never touches the disk,
 * so the tests can rebuild both files in memory and compare.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadSampleFiles } from "../seed/sample-files";
import { buildNearbyOutlines, serializeOutlines, type CsbFeature, type FarmField, type LonLat } from "./outlines";
import { renderPreview, type FieldLabel } from "./preview";

export const CSB_CLIP = path.join("reference", "csb-near-daves-farm.geojson");
export const OUTLINES_FILE = "nearby-outlines.geojson";
export const PREVIEW_FILE = path.join("reference", "outlines-preview.html");

const position = z.tuple([z.number(), z.number()]);

/** The clip as DuckDB wrote it: USDA NASS Crop Sequence Boundaries around the farm, in longitude and latitude. */
const clipSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      properties: z.object({ id: z.string().min(1), crop: z.string().nullable() }),
      geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(position)) }),
    }),
  ),
});

export interface OutlineInputs {
  fields: (FarmField & FieldLabel)[];
  bins: { name: string; location: LonLat }[];
  clip: CsbFeature[];
}

export function loadOutlineInputs(dir = path.resolve("sample-data")): OutlineInputs {
  const { farm, fields } = loadSampleFiles(dir);
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, CSB_CLIP), "utf8"));
  const clip = clipSchema.safeParse(raw);
  if (!clip.success) {
    throw new Error(`sample-data/${CSB_CLIP} is not the clip this expects:\n${z.prettifyError(clip.error)}`);
  }
  return {
    fields: fields.map((f) => ({
      id: f.id,
      name: f.properties.name,
      expected_acres: f.properties.expected_acres,
      geometry: f.geometry,
    })),
    bins: farm.bins.map((bin) => ({ name: bin.name, location: bin.location })),
    clip: clip.data.features,
  };
}

/** Both built files as text, keyed by where they go under sample-data. */
export function buildOutlineFiles(inputs: OutlineInputs): Record<string, string> {
  const outlines = buildNearbyOutlines(
    inputs.fields,
    inputs.bins.map((bin) => bin.location),
    inputs.clip,
  );
  return {
    [OUTLINES_FILE]: serializeOutlines(outlines),
    [PREVIEW_FILE]: renderPreview({ outlines, fields: inputs.fields, bins: inputs.bins, clip: inputs.clip }),
  };
}
