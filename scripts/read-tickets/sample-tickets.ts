/**
 * Pairs the sample photos with their answers in documents-2026.json by file
 * name: photos/ticket-3.jpg is the document named "ticket-3". Pure.
 */
import type { AnswerKey } from "../../lib/extract/score";
import type { HarvestWindow } from "../../lib/rules/ticket-checks";
import type { DocumentsFile } from "../print/documents-file";
import type { Season } from "../seed/sample-files";

export interface SampleTicket {
  /** The document's name, such as "ticket-3". */
  name: string;
  /** The photo's file name, such as "ticket-3.jpg". */
  photo: string;
  filledIn: "printed" | "by_hand";
  expected: AnswerKey;
}

export interface PhotoMatch {
  tickets: SampleTicket[];
  /** Photos of other kinds of document, which the ticket reader doesn't read. */
  skipped: string[];
  /** One sentence each. Nothing is read while there are any. */
  problems: string[];
}

const PHOTO = /^(.+)\.jpe?g$/i;

export function matchPhotos(photoFiles: readonly string[], file: DocumentsFile): PhotoMatch {
  const match: PhotoMatch = { tickets: [], skipped: [], problems: [] };
  const photographed = new Set<string>();

  for (const photo of [...photoFiles].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    const name = PHOTO.exec(photo)?.[1];
    if (!name) continue; // README.md and anything else that isn't a photo
    const doc = file.documents[name];
    if (!doc) {
      match.problems.push(`${photo} has no document named "${name}" in documents-2026.json.`);
    } else if (photographed.has(name)) {
      match.problems.push(`"${name}" has more than one photo.`);
    } else if (doc.kind !== "scale_ticket") {
      match.skipped.push(photo);
    } else {
      match.tickets.push({ name, photo, filledIn: doc.filled_in, expected: doc.values });
    }
    photographed.add(name);
  }

  for (const [name, doc] of Object.entries(file.documents)) {
    if (doc.kind === "scale_ticket" && !photographed.has(name)) {
      match.problems.push(`${name} has no photo. Expected sample-data/photos/${name}.jpg.`);
    }
  }
  return match;
}

/** Harvest for the sample season: after the last field finished planting, through the end of the crop year. */
export function sampleHarvestWindow(season: Season): HarvestWindow {
  const plantingDone = season.field_seasons.map((fs) => fs.planting_completed_date).sort().at(-1);
  if (!plantingDone) throw new Error("season-2026.json has no field seasons, so there is no harvest to check dates against.");
  return { after: plantingDone, through: `${season.policy.crop_year}-12-31` };
}
