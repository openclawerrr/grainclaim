/**
 * Pairs the sample FSA map, FSA-578 and Summary of Coverage with their answers
 * in documents-2026.json by name: a document delivered as a photo is
 * photos/<name>.jpg, and one delivered as a PDF is print/<name>.pdf. Pure.
 */
import { DOCUMENT_KINDS, type DocumentKindKey } from "../../lib/extract/document-kinds";
import type { NamedValue } from "../../lib/extract/score-document";
import type { DocumentsFile } from "../print/documents-file";

export interface SampleDocument {
  /** The document's name, such as "fsa-578". */
  name: string;
  kind: DocumentKindKey;
  /** The file to read, from sample-data: "photos/fsa-578.jpg". */
  file: string;
  /** The answer key's values, by name. */
  expected: NamedValue[];
}

export interface DocumentMatch {
  documents: SampleDocument[];
  /** One sentence each. Nothing is read while there are any. */
  problems: string[];
}

const isFormKind = (kind: string): kind is DocumentKindKey => kind in DOCUMENT_KINDS;

/** `photoFiles` and `printFiles` are the file names in sample-data/photos and sample-data/print. */
export function matchDocuments(
  photoFiles: readonly string[],
  printFiles: readonly string[],
  file: DocumentsFile,
): DocumentMatch {
  const match: DocumentMatch = { documents: [], problems: [] };

  for (const [name, doc] of Object.entries(file.documents)) {
    if (!isFormKind(doc.kind)) continue; // tickets and settlements have their own readers
    const found =
      doc.delivery === "photo"
        ? photoFiles.filter((f) => new RegExp(`^${name}\\.jpe?g$`, "i").test(f)).map((f) => `photos/${f}`)
        : printFiles.filter((f) => f.toLowerCase() === `${name}.pdf`).map((f) => `print/${f}`);
    if (found.length === 0) {
      const expected = doc.delivery === "photo" ? `photos/${name}.jpg` : `print/${name}.pdf`;
      match.problems.push(`${name} has no ${doc.delivery === "photo" ? "photo" : "PDF"}. Expected sample-data/${expected}.`);
    } else if (found.length > 1) {
      match.problems.push(`"${name}" has more than one photo.`);
    } else {
      match.documents.push({
        name,
        kind: doc.kind,
        file: found[0],
        expected: DOCUMENT_KINDS[doc.kind].named(doc.values),
      });
    }
  }
  return match;
}
