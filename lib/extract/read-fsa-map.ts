/**
 * Reads one FSA aerial map (the farm map FSA prints on an aerial photo, with
 * each field outlined and labeled), from a photo or the PDF itself, with
 * Claude structured outputs. The API call, and what counts as a failed read,
 * are in read.ts.
 *
 * It returns what is printed on the map and no coordinates: a photo of a map
 * doesn't say where on the earth its fields are.
 *
 * Server-side only: the Anthropic client takes ANTHROPIC_API_KEY from the
 * environment. Never import this from a client component.
 */
import { fromFsaMapWire, fsaMapReadSchema, fsaMapWireSchema, type FsaMapRead } from "./fsa-map-schema";
import {
  COPYING_RULES,
  photoOrPdfBlock,
  readWithClaude,
  validateAgainst,
  type ReadOptions,
  type ReadResult,
  type Validated,
} from "./read";

/** The model copies; lib/rules/fsa-map-checks.ts checks. */
const SYSTEM_PROMPT = `You read FSA aerial maps (the Farm Service Agency's farm and tract maps) for a farm's records. The map is an aerial photo of one farm with each field outlined and labeled, a heading that names the farm and its tracts, and a legend. It may be a phone photo of a printed page or of a screen, or the file itself.

${COPYING_RULES}
- Each field's label is printed inside its outline: its field number, its acres, and an erodibility code. Keep the values of one label together, and give one entry for every labeled field.
- The legend shows how a tract boundary, a cropland field and a non-cropland field are drawn. Use it to tell them apart on the photo.
- A field belongs to the tract whose boundary surrounds it. Read which boundary each label sits inside; don't go by the order the tracts are listed in the heading.`;

export type FsaMapReadResult = ReadResult<FsaMapRead>;

/**
 * Sends the map as it is and returns the values read from it. A read the
 * model refused, cut short or returned in the wrong shape comes back as
 * `ok: false`. Errors from the API itself are thrown.
 */
export async function readFsaMap(file: Uint8Array, options: ReadOptions): Promise<FsaMapReadResult> {
  return readWithClaude(
    {
      system: SYSTEM_PROMPT,
      file: photoOrPdfBlock(file, "An FSA map"),
      instruction: "Read this FSA map.",
      wireSchema: fsaMapWireSchema,
      toValues: (wire) => validateFsaMap(fromFsaMapWire(wire)),
    },
    options,
  );
}

/** Holds the answer to the app's schema. */
export function validateFsaMap(values: unknown): Validated<FsaMapRead> {
  return validateAgainst(fsaMapReadSchema, values, "FSA map");
}
