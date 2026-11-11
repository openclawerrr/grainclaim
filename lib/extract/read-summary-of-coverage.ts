/**
 * Reads one crop insurance Summary of Coverage, from the PDF itself or a
 * photo, with Claude structured outputs. The API call, and what counts as a
 * failed read, are in read.ts.
 *
 * Server-side only: the Anthropic client takes ANTHROPIC_API_KEY from the
 * environment. Never import this from a client component.
 */
import {
  COPYING_RULES,
  photoOrPdfBlock,
  readWithClaude,
  validateAgainst,
  type ReadOptions,
  type ReadResult,
  type Validated,
} from "./read";
import {
  fromSummaryOfCoverageWire,
  summaryOfCoverageReadSchema,
  summaryOfCoverageWireSchema,
  type SummaryOfCoverageRead,
} from "./summary-of-coverage-schema";

/** The model copies; lib/rules/summary-of-coverage-checks.ts checks. */
const SYSTEM_PROMPT = `You read crop insurance Summary of Coverage documents for a farm's records. A summary names the insured and the policy, gives the policy's terms (crop, plan, coverage level, prices), and lists each insured unit with its acres, share, yield, guarantee and liability. It may be the insurer's PDF or a phone photo of a printed page.

${COPYING_RULES}
- The guarantee and liability on each unit's row, and the totals under the table, are printed on the document. Copy them from the page; never work them out from the yield, acres or price.`;

export type SummaryOfCoverageReadResult = ReadResult<SummaryOfCoverageRead>;

/**
 * Sends the summary as it is and returns the values read from it. A file that
 * isn't this kind of document, and a read the model refused, cut short or
 * returned in the wrong shape, come back as `ok: false`. Errors from the API itself are thrown.
 */
export async function readSummaryOfCoverage(
  file: Uint8Array,
  options: ReadOptions,
): Promise<SummaryOfCoverageReadResult> {
  return readWithClaude(
    {
      expects: "summary_of_coverage",
      system: SYSTEM_PROMPT,
      file: photoOrPdfBlock(file, "A Summary of Coverage"),
      instruction: "Read this Summary of Coverage.",
      wireSchema: summaryOfCoverageWireSchema,
      toValues: (wire) => validateSummaryOfCoverage(fromSummaryOfCoverageWire(wire)),
    },
    options,
  );
}

/** Holds the answer to the app's schema. */
export function validateSummaryOfCoverage(values: unknown): Validated<SummaryOfCoverageRead> {
  return validateAgainst(summaryOfCoverageReadSchema, values, "Summary of Coverage");
}
