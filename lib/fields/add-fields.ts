/**
 * Adding fields from a photo of the farmer's FSA map, start to finish, in two
 * steps (spec Phase 2, demo beat 1):
 *
 * 1. `readFsaMapPhoto`: the farmer adds the photo and clicks roughly where
 *    his farm is. The file is hashed, read, checked and saved as a document
 *    (file and read values, which lock once saved). The public outlines near
 *    the click are loaded and the map's cropland fields are paired with them
 *    (lib/rules/field-proposal.ts). The pairs come back for him to look at
 *    and name. No field is written.
 *
 * 2. `confirmFields`: he confirms. The pairs are worked out again from the
 *    saved document and his click, never from an outline the browser sends,
 *    and each field is written with its outline, FSA numbers and a link to
 *    the document. A field whose FSA numbers are already on the farm is
 *    skipped, and said so.
 *
 * A file that was already added is not read again: its saved reading is used.
 * The reader also says what kind of document the file is. A file that isn't
 * an FSA map is refused before anything of it is saved.
 *
 * The reader, the photo's EXIF, the outlines and the database are passed in,
 * so this is tested without Claude or Supabase (add-fields.test.ts). The real
 * ones are wired up in app/fields/actions.ts.
 */
import { fsaMapReadSchema, type FsaMapRead } from "../extract/fsa-map-schema";
import { READ_MODELS } from "../extract/models";
import type { ReadResult } from "../extract/read";
import { documentFilePath, documentFileType, sha256Hex, type CaptureInfo, type DocumentFileType } from "../photos/photo-file";
import type { Role } from "../role/role";
import type { DocumentCheck } from "../rules/document-checks";
import { addedBeforeMessage, wrongKindMessage } from "../rules/document-kind";
import { fieldNameProblem, tidyFieldName } from "../rules/field-names";
import {
  alreadyOnMapSentence,
  fsaFieldKey,
  proposeFieldsFromMap,
  type ExistingField,
  type FieldProposal,
  type ProposedField,
} from "../rules/field-proposal";
import { checkFsaMap } from "../rules/fsa-map-checks";
import type { MapSpot, PublicOutline } from "../rules/outline-pairing";

// ---------------------------------------------------------------------------
// What adding fields needs from the database (implemented in lib/db/field-store.ts)
// ---------------------------------------------------------------------------

/** A document as the database holds it. */
export interface SavedDocument {
  id: string;
  kind: string;
  /** The values read from the file, as saved. Null if it was never read. */
  readValues: unknown;
  readChecks: DocumentCheck[];
}

/** The FSA map's row in `document`. */
export interface NewFsaMapDocument {
  insured_id: string;
  kind: "fsa_map";
  file_path: string;
  file_sha256: string;
  media_type: DocumentFileType["mediaType"];
  captured_at: string | null;
  /** EWKT, or null when the file carries no GPS. */
  capture_location: string | null;
  uploaded_by: Role;
  read_values: unknown;
  read_checks: DocumentCheck[];
  read_model: string;
  read_at: string;
}

/** A field row to insert. The database adds the id and measures the acres from the outline. */
export interface NewField {
  insured_id: string;
  name: string;
  fsa_farm: string;
  fsa_tract: string;
  fsa_field: string;
  state: string;
  county: string;
  /** EWKT: SRID=4326;POLYGON((longitude latitude, ...)). */
  boundary: string;
  /** The section, township and range printed on the map. */
  legal_description: string | null;
  source: "ai_proposed";
  hel_status: "HEL" | "NHEL" | null;
  cropland: true;
  /** The acres the FSA map prints for the field. */
  fsa_map_acres: number;
  fsa_map_document_id: string;
}

/** A field as the database holds it, in the shape the farm map draws. */
export interface SavedField {
  id: string;
  name: string;
  /** Acres the database measured from the outline. */
  acres: number | null;
  outline: [number, number][][];
}

export interface FieldStore {
  /** The farm and the fields on its map. Null if no farm is set up. */
  loadFarm(): Promise<{ insuredId: string; fields: ExistingField[] } | null>;
  findDocumentByHash(hash: string): Promise<SavedDocument | null>;
  loadDocument(id: string): Promise<SavedDocument | null>;
  /** Stores the original file. Storing bytes that are already there is not an error. */
  saveFile(path: string, file: Uint8Array, type: DocumentFileType): Promise<void>;
  insertDocument(document: NewFsaMapDocument): Promise<SavedDocument>;
  /** Writes every field or none. */
  insertFields(fields: NewField[]): Promise<SavedField[]>;
  confirmDocuments(ids: string[], who: Role, at: string): Promise<void>;
  /** Takes back fields a confirm wrote, when a later step fails. */
  removeFields(ids: string[]): Promise<void>;
}

export interface AddFieldsDeps {
  store: FieldStore;
  readFsaMap(file: Uint8Array): Promise<ReadResult<FsaMapRead>>;
  /** The time and GPS a photo carries. */
  captureInfo(photo: Uint8Array): Promise<CaptureInfo>;
  /** Public field outlines around a spot. The pairing rule decides which are near enough. */
  outlinesNear(spot: MapSpot): Promise<PublicOutline[]>;
  now(): Date;
}

// ---------------------------------------------------------------------------
// Step 1: read the map and pair its fields with outlines
// ---------------------------------------------------------------------------

export type ReadFsaMapOutcome =
  | {
      status: "ready";
      /** The saved document the proposal was worked out from. Confirming names it. */
      documentId: string;
      /** Where the farmer clicked. Confirming sends it back, so the same outlines are looked at. */
      click: MapSpot;
      proposal: FieldProposal;
      /** Checks on the read values that didn't add up: one sentence each, to look at before confirming. */
      warnings: string[];
    }
  /** No fields can be proposed from this file. One plain sentence per reason. */
  | { status: "not_ready"; messages: string[] };

const notReady = (...messages: string[]): ReadFsaMapOutcome => ({ status: "not_ready", messages });

const FARMER_ONLY = "Only the farmer adds fields. Switch to Farmer to add them.";
const NO_FARM = "Your farm isn't set up yet, so there is nowhere to add fields.";
const CLICK_THE_MAP = "Click the map roughly where your farm is.";

const validSpot = ({ longitude, latitude }: MapSpot) =>
  Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90;

const ewktPoint = ({ longitude, latitude }: MapSpot) => `SRID=4326;POINT(${longitude} ${latitude})`;

/** PostGIS reads this as a polygon in longitude and latitude (WGS 84): the outer ring, then any holes. */
export function ewktPolygon(rings: readonly (readonly (readonly number[])[])[]): string {
  const ring = (points: readonly (readonly number[])[]) => `(${points.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`;
  return `SRID=4326;POLYGON(${rings.map(ring).join(",")})`;
}

const parseMap = (values: unknown): FsaMapRead | null => fsaMapReadSchema.safeParse(values).data ?? null;
const failedChecks = (checks: readonly DocumentCheck[]) => checks.filter((c) => c.status === "fail").map((c) => c.message);

type Added = { ok: true; id: string; values: FsaMapRead; checks: DocumentCheck[] } | { ok: false; message: string };

/** Saves the file as a document, reading it first unless this exact file was read before. */
async function addFsaMapDocument(
  file: Uint8Array,
  type: DocumentFileType,
  insuredId: string,
  who: Role,
  deps: AddFieldsDeps,
): Promise<Added> {
  const hash = sha256Hex(file);

  const before = await deps.store.findDocumentByHash(hash);
  if (before) {
    if (before.kind !== "fsa_map") return { ok: false, message: addedBeforeMessage("fsa_map", before.kind) };
    const values = parseMap(before.readValues);
    if (values) return { ok: true, id: before.id, values, checks: before.readChecks };
    return { ok: false, message: "Your FSA map was added before but couldn't be read then. Take a new photo of it and add that." };
  }

  const read = await deps.readFsaMap(file);
  if (!read.ok) {
    // Not an FSA map: nothing of it is saved, so it can still be added where it belongs.
    if (read.wrongKind) return { ok: false, message: wrongKindMessage("fsa_map", read.wrongKind) };
    return { ok: false, message: "Your FSA map couldn't be read. Try a clearer photo, with the whole map flat and in the frame." };
  }
  const checks = checkFsaMap(read.values);
  // A PDF carries no camera time or GPS.
  const capture = type.mediaType === "application/pdf" ? { capturedAt: null, location: null } : await deps.captureInfo(file);

  const path = documentFilePath(hash, type);
  await deps.store.saveFile(path, file, type);
  const saved = await deps.store.insertDocument({
    insured_id: insuredId,
    kind: "fsa_map",
    file_path: path,
    file_sha256: hash,
    media_type: type.mediaType,
    captured_at: capture.capturedAt,
    capture_location: capture.location ? ewktPoint(capture.location) : null,
    uploaded_by: who,
    read_values: read.values,
    read_checks: checks,
    read_model: READ_MODELS[read.model].id,
    read_at: deps.now().toISOString(),
  });
  return { ok: true, id: saved.id, values: read.values, checks };
}

export async function readFsaMapPhoto(file: Uint8Array, click: MapSpot, role: Role, deps: AddFieldsDeps): Promise<ReadFsaMapOutcome> {
  if (role !== "farmer") return notReady(FARMER_ONLY);
  const type = documentFileType(file);
  if (!type) return notReady("Your FSA map must be a JPEG or PNG photo, or a PDF.");
  if (!validSpot(click)) return notReady(CLICK_THE_MAP);

  const farm = await deps.store.loadFarm();
  if (!farm) return notReady(NO_FARM);

  const added = await addFsaMapDocument(file, type, farm.insuredId, role, deps);
  if (!added.ok) return notReady(added.message);

  const outlines = await deps.outlinesNear(click);
  const result = proposeFieldsFromMap(added.values, outlines, click, farm.fields);
  if (!result.ok) return notReady(...result.problems);

  return { status: "ready", documentId: added.id, click, proposal: result.proposal, warnings: failedChecks(added.checks) };
}

// ---------------------------------------------------------------------------
// Step 2: the farmer confirms
// ---------------------------------------------------------------------------

/** What the farmer confirmed, as the form sends it. Only the names are his to give. */
export interface ConfirmFieldsInput {
  documentId: string;
  click: MapSpot;
  /** One per field he was shown: which field, which outline it was paired with, and the name he gave it. */
  fields: { key: string; outlineId: string; name: string }[];
}

export type ConfirmFieldsOutcome =
  | {
      status: "saved";
      fields: SavedField[];
      /** One sentence per field that was skipped because the farm already has it. */
      skipped: string[];
    }
  /** Nothing was saved. `key` is the field the first sentence is about, if it is about one. */
  | { status: "not_saved"; messages: string[]; key?: string };

const notSaved = (...messages: string[]): ConfirmFieldsOutcome => ({ status: "not_saved", messages });

const READ_AGAIN = "That FSA map can't be found any more. Add its photo again.";
const CHANGED = "What matches your map has changed since you looked. Nothing was saved. Read your map again.";

const helStatus = (hel: string | null): NewField["hel_status"] => (hel === "HEL" || hel === "NHEL" ? hel : null);

export async function confirmFields(
  input: ConfirmFieldsInput,
  role: Role,
  deps: Pick<AddFieldsDeps, "store" | "outlinesNear" | "now">,
): Promise<ConfirmFieldsOutcome> {
  if (role !== "farmer") return notSaved(FARMER_ONLY);
  if (!validSpot(input.click)) return notSaved(CLICK_THE_MAP);
  const { store } = deps;

  const [document, farm] = await Promise.all([store.loadDocument(input.documentId), store.loadFarm()]);
  if (!farm) return notSaved(NO_FARM);
  if (document?.kind !== "fsa_map") return notSaved(READ_AGAIN);
  const map = parseMap(document.readValues);
  if (!map) return notSaved(READ_AGAIN);

  // Worked out again from what is saved: the browser only said which document, where he clicked, and the names.
  const result = proposeFieldsFromMap(map, await deps.outlinesNear(input.click), input.click, farm.fields);
  if (!result.ok) return notSaved(...result.problems);
  const { proposal } = result;

  // Every field about to be saved must be one he was shown, with the outline he was shown.
  const shown = new Map(input.fields.map((field) => [field.key, field]));
  if (proposal.fields.some((field) => shown.get(field.key)?.outlineId !== field.outlineId)) return notSaved(CHANGED);

  // A field he was shown that isn't proposed any more: fine if the farm now has it (skipped), a change otherwise.
  const skipped: string[] = [];
  for (const { key } of input.fields) {
    if (proposal.fields.some((field) => field.key === key)) continue;
    const have = farm.fields.find((field) => fsaFieldKey(field.fsa_farm, field.fsa_tract, field.fsa_field) === key);
    if (!have) return notSaved(CHANGED);
    skipped.push(alreadyOnMapSentence({ tract: have.fsa_tract, field: have.fsa_field }, have, "skipped"));
  }
  if (proposal.fields.length === 0) return { status: "saved", fields: [], skipped };

  const taken = farm.fields.map((field) => field.name);
  const rows: NewField[] = [];
  for (const field of proposal.fields) {
    const name = tidyFieldName(shown.get(field.key)!.name);
    const problem = fieldNameProblem(name, [...taken, ...rows.map((row) => row.name)]);
    if (problem) return { status: "not_saved", messages: [problem], key: field.key };
    rows.push(fieldRow(field, name, proposal, farm.insuredId, document.id));
  }

  const saved = await store.insertFields(rows);
  try {
    await store.confirmDocuments([document.id], role, deps.now().toISOString());
  } catch (error) {
    // The REST API has no transactions, so take the fields back out.
    await store.removeFields(saved.map((field) => field.id)).catch((undoError: unknown) => {
      console.error("Removing half-saved fields failed:", undoError instanceof Error ? undoError.message : undoError);
    });
    throw error;
  }
  return { status: "saved", fields: saved, skipped };
}

function fieldRow(field: ProposedField, name: string, proposal: FieldProposal, insuredId: string, documentId: string): NewField {
  return {
    insured_id: insuredId,
    name,
    fsa_farm: field.fsaFarm,
    fsa_tract: field.fsaTract,
    fsa_field: field.fsaField,
    state: proposal.state,
    county: proposal.county,
    boundary: ewktPolygon(field.outline),
    legal_description: proposal.legalDescription,
    source: "ai_proposed",
    hel_status: helStatus(field.hel),
    cropland: true,
    fsa_map_acres: field.fsaMapAcres,
    fsa_map_document_id: documentId,
  };
}
