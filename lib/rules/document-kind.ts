/**
 * The kinds of document a farmer hands GrainClaim, and what he is told when
 * a file isn't the kind its slot is for. Pure: plain data in, a sentence out.
 *
 * Every reader says what the document in front of it is, in the same read
 * (lib/extract/read.ts). A file of the wrong kind is refused before anything
 * is saved, so it can still be added later where it belongs.
 */

/** What a document can be named as. A reader expects one of these. */
export const DOCUMENT_KIND_NAMES = ["fsa_578", "summary_of_coverage", "fsa_map", "scale_ticket", "settlement"] as const;
export type DocumentKindName = (typeof DOCUMENT_KIND_NAMES)[number];

/** What a reader can say a file is: one of the kinds, or "other" for anything else. */
export const SEEN_KINDS = [...DOCUMENT_KIND_NAMES, "other"] as const;
export type SeenKind = (typeof SEEN_KINDS)[number];

interface KindWords {
  /** What people call it: "FSA-578". */
  title: string;
  /** With its article: "an FSA-578". */
  a: string;
  /** What to do next, as one sentence. */
  choose: string;
}

const WORDS: Record<DocumentKindName, KindWords> = {
  fsa_578: { title: "FSA-578", a: "an FSA-578", choose: "Choose your FSA-578." },
  summary_of_coverage: { title: "Summary of Coverage", a: "a Summary of Coverage", choose: "Choose your Summary of Coverage." },
  fsa_map: { title: "FSA map", a: "an FSA map", choose: "Choose a photo of your FSA map." },
  scale_ticket: { title: "scale ticket", a: "a scale ticket", choose: "Choose a photo of the ticket." },
  settlement: { title: "settlement", a: "a settlement", choose: "Choose your settlement." },
};

const isKindName = (kind: string): kind is DocumentKindName => Object.hasOwn(WORDS, kind);

/** "FSA-578" for "fsa_578". Null for a kind that has no name here. */
export function documentKindTitle(kind: string): string | null {
  return isKindName(kind) ? WORDS[kind].title : null;
}

/** "an FSA-578" for "fsa_578". */
export function aDocumentOfKind(kind: DocumentKindName): string {
  return WORDS[kind].a;
}

/**
 * What the farmer is told when the file he chose isn't the kind its slot is
 * for: what it looks like, what was wanted, and what to do.
 * "This looks like an FSA map, not an FSA-578. Choose your FSA-578."
 */
export function wrongKindMessage(expected: DocumentKindName, seen: SeenKind): string {
  const wanted = WORDS[expected];
  if (seen === "other") return `This doesn't look like ${wanted.a}. ${wanted.choose}`;
  return `This looks like ${WORDS[seen].a}, not ${wanted.a}. ${wanted.choose}`;
}

/**
 * What the farmer is told when the file he chose was saved earlier as a
 * different kind of document. Nothing is read: the saved file says what it is.
 * "This file was added before as your FSA map. Choose your FSA-578."
 */
export function addedBeforeMessage(expected: DocumentKindName, savedAs: string): string {
  const title = documentKindTitle(savedAs);
  return `This file was added before as ${title ? `your ${title}` : "another document"}. ${WORDS[expected].choose}`;
}
