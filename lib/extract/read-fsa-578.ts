/**
 * Reads one FSA-578 (Report of Acreage), from a photo or the PDF itself, with
 * Claude structured outputs. The API call, and what counts as a failed read,
 * are in read.ts.
 *
 * Server-side only: the Anthropic client takes ANTHROPIC_API_KEY from the
 * environment. Never import this from a client component.
 */
import { fromFsa578Wire, fsa578ReadSchema, fsa578WireSchema, type Fsa578Read } from "./fsa-578-schema";
import {
  COPYING_RULES,
  photoOrPdfBlock,
  readWithClaude,
  validateAgainst,
  type ReadOptions,
  type ReadResult,
  type Validated,
} from "./read";

/** The model copies; lib/rules/fsa-578-checks.ts checks. */
const SYSTEM_PROMPT = `You read FSA-578 forms (the Farm Service Agency's Report of Acreage) for a farm's records. The form lists a farm's tracts and fields, the crop reported on each, and each producer's share. It may be a phone photo of a printed page or the file itself.

${COPYING_RULES}
- The table of tracts and fields has one line for each field and crop. Read across each line: its tract and field number, crop, practice and crop status, the acres in the crop's column, and the keys and shares beside it. A field's shares can take more than one row; they all belong to that field's line.`;

export type Fsa578ReadResult = ReadResult<Fsa578Read>;

/**
 * Sends the form as it is and returns the values read from it. A file that
 * isn't this kind of document, and a read the model refused, cut short or
 * returned in the wrong shape, come back as `ok: false`. Errors from the API itself are thrown.
 */
export async function readFsa578(file: Uint8Array, options: ReadOptions): Promise<Fsa578ReadResult> {
  return readWithClaude(
    {
      expects: "fsa_578",
      system: SYSTEM_PROMPT,
      file: photoOrPdfBlock(file, "An FSA-578"),
      instruction: "Read this FSA-578.",
      wireSchema: fsa578WireSchema,
      toValues: (wire) => validateFsa578(fromFsa578Wire(wire)),
    },
    options,
  );
}

/** Holds the answer to the app's schema. */
export function validateFsa578(values: unknown): Validated<Fsa578Read> {
  return validateAgainst(fsa578ReadSchema, values, "FSA-578");
}
