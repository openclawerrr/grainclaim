/**
 * The public field outlines GrainClaim pairs a photo of an FSA map with.
 *
 * For the demo they come from one file, sample-data/nearby-outlines.geojson:
 * the outlines around Dave's sample farm, with no names and no FSA numbers.
 * Fetching real USDA Crop Sequence Boundaries around the farmer's click
 * comes after the hackathon; it replaces this file and nothing else, because
 * the pairing rule (lib/rules/outline-pairing.ts) already decides which
 * outlines are near enough to the click.
 *
 * Server-side only: it reads a file from disk.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PublicOutline } from "../rules/outline-pairing";

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** A closed ring: at least a triangle, ending where it starts. */
const ring = z
  .array(position)
  .min(4)
  .refine((points) => points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1], {
    message: "a ring must end where it starts",
  });

const outlinesFile = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      id: z.string().min(1),
      geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1) }),
    }),
  ),
});

export const SAMPLE_OUTLINES_FILE = path.join("sample-data", "nearby-outlines.geojson");

/** Every outline in the sample file. `root` is the project folder. */
export async function loadSampleOutlines(root = process.cwd()): Promise<PublicOutline[]> {
  const raw: unknown = JSON.parse(await readFile(path.join(root, SAMPLE_OUTLINES_FILE), "utf8"));
  const file = outlinesFile.safeParse(raw);
  if (!file.success) throw new Error(`${SAMPLE_OUTLINES_FILE} is not an outlines file:\n${z.prettifyError(file.error)}`);
  return file.data.features.map((feature) => ({ id: feature.id, coordinates: feature.geometry.coordinates }));
}
