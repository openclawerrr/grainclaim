/**
 * The documents that are read as a whole: the FSA map, the FSA-578 and the
 * Summary of Coverage. Each kind has a reader, a list of its values by name,
 * and checks. (Tickets have their own reader and scorer; see read-ticket.ts.)
 *
 * Server-side only, because the readers call Claude.
 */
import type { DocumentCheck } from "../rules/document-checks";
import { checkFsa578 } from "../rules/fsa-578-checks";
import { checkFsaMap } from "../rules/fsa-map-checks";
import { checkSummaryOfCoverage } from "../rules/summary-of-coverage-checks";
import { fsa578ReadSchema, fsa578Values } from "./fsa-578-schema";
import { fsaMapReadSchema, fsaMapValues } from "./fsa-map-schema";
import type { ReadOptions, ReadResult } from "./read";
import { readFsa578 } from "./read-fsa-578";
import { readFsaMap } from "./read-fsa-map";
import { readSummaryOfCoverage } from "./read-summary-of-coverage";
import type { NamedValue } from "./score-document";
import { summaryOfCoverageReadSchema, summaryOfCoverageValues } from "./summary-of-coverage-schema";

/** One read document: every value by name, and the checks run on them. */
export interface ReadDocument {
  values: NamedValue[];
  checks: DocumentCheck[];
}

export interface DocumentKind {
  /** What people call it: "FSA-578". */
  title: string;
  /** Reads a photo or PDF, names the values and runs the checks. */
  read(file: Uint8Array, options: ReadOptions): Promise<ReadResult<ReadDocument>>;
  /** An answer key's values by name. Throws if the key doesn't fit the kind's schema. */
  named(answerKey: unknown): NamedValue[];
}

/** Keeps how the read went and swaps its values for the named values and checks. */
function withValues<T>(result: ReadResult<T>, describe: (values: T) => ReadDocument): ReadResult<ReadDocument> {
  if (!result.ok) return result;
  return { ...result, values: describe(result.values) };
}

/** Keyed like `kind` in sample-data/documents-2026.json. */
export const DOCUMENT_KINDS = {
  fsa_map: {
    title: "FSA map",
    read: async (file, options) =>
      withValues(await readFsaMap(file, options), (map) => ({ values: fsaMapValues(map), checks: checkFsaMap(map) })),
    named: (answerKey) => fsaMapValues(fsaMapReadSchema.parse(answerKey)),
  },
  fsa_578: {
    title: "FSA-578",
    read: async (file, options) =>
      withValues(await readFsa578(file, options), (form) => ({ values: fsa578Values(form), checks: checkFsa578(form) })),
    named: (answerKey) => fsa578Values(fsa578ReadSchema.parse(answerKey)),
  },
  summary_of_coverage: {
    title: "Summary of Coverage",
    read: async (file, options) =>
      withValues(await readSummaryOfCoverage(file, options), (summary) => ({
        values: summaryOfCoverageValues(summary),
        checks: checkSummaryOfCoverage(summary),
      })),
    named: (answerKey) => summaryOfCoverageValues(summaryOfCoverageReadSchema.parse(answerKey)),
  },
} as const satisfies Record<string, DocumentKind>;

export type DocumentKindKey = keyof typeof DOCUMENT_KINDS;
export const DOCUMENT_KIND_KEYS = Object.keys(DOCUMENT_KINDS) as DocumentKindKey[];
