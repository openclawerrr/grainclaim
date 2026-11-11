/**
 * Season setup, start to finish, in two steps the farmer sees as one screen:
 *
 * 1. `readSeasonDocuments`: the farmer adds his FSA-578 and Summary of
 *    Coverage. Each file is hashed, read, checked and saved as a document
 *    (file and read values, which lock once saved). The season they describe
 *    is worked out (lib/rules/season-setup.ts) and returned for him to look
 *    at. No season record is written yet.
 *
 * 2. `confirmSeason`: he confirms. The season is worked out again from the
 *    saved documents, never from anything the browser sends, and the policy,
 *    units, field seasons and flags are written. A field on the FSA-578 that
 *    no unit covers gets a field season too, marked not insured, with no unit.
 *
 * A file that was already added is not read again: its saved reading is
 * used. If writing the season fails part-way, what was written is removed.
 *
 * The readers, the photo's EXIF and the database are passed in, so this is
 * tested without Claude or Supabase (setup-season.test.ts). The real ones are
 * wired up in app/season/actions.ts.
 */
import { fsa578ReadSchema, type Fsa578Read } from "../extract/fsa-578-schema";
import { READ_MODELS } from "../extract/models";
import type { ReadResult } from "../extract/read";
import { summaryOfCoverageReadSchema, type SummaryOfCoverageRead } from "../extract/summary-of-coverage-schema";
import { documentFilePath, documentFileType, sha256Hex, type CaptureInfo, type DocumentFileType } from "../photos/photo-file";
import type { Role } from "../role/role";
import type { DocumentCheck } from "../rules/document-checks";
import { checkFsa578 } from "../rules/fsa-578-checks";
import {
  proposeSeason,
  type MappedField,
  type ProposedFieldSeason,
  type ProposedFlag,
  type SeasonProposal,
} from "../rules/season-setup";
import { checkSummaryOfCoverage } from "../rules/summary-of-coverage-checks";

export type SeasonDocumentKind = "fsa_578" | "summary_of_coverage";

const TITLES: Record<SeasonDocumentKind, string> = { fsa_578: "FSA-578", summary_of_coverage: "Summary of Coverage" };

// ---------------------------------------------------------------------------
// What season setup needs from the database (implemented in lib/db/season-store.ts)
// ---------------------------------------------------------------------------

/** A document as the database holds it. */
export interface SavedDocument {
  id: string;
  kind: string;
  /** The values read from the file, as saved. Null if it was never read. */
  readValues: unknown;
  readChecks: DocumentCheck[];
}

/** A document row to insert. */
export interface NewDocument {
  insured_id: string;
  kind: SeasonDocumentKind;
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

export interface NewPolicy {
  insured_id: string;
  crop: string;
  state: string;
  county: string;
  crop_year: number;
  policy_number: string | null;
  plan: string;
  coverage_level: number;
  price_election: number;
  unit_structure: string;
  approved_yield: number;
  projected_price: number | null;
}

export interface NewUnit {
  policy_id: string;
  unit_number: string;
  unit_type: string;
  practice: string;
  share_arrangement: string;
  insured_share: number;
}

export interface NewFieldSeason {
  field_id: string;
  /** Null for a field that is in no unit. The database requires a unit when insured and none when not. */
  unit_id: string | null;
  crop_year: number;
  crop: string;
  planted_acres: number;
  planting_date: string | null;
  practice: string;
  insured: boolean;
}

export interface NewFlag {
  flag_type: string;
  severity: "warn";
  message: string;
  record_type: "unit" | "field" | "document";
  record_id: string;
  related: { type: "field" | "document"; id: string }[];
  created_by: Role;
}

/** What one confirmed setup wrote, so a failure part-way can take it back out. */
export interface WrittenSeason {
  policyId: string | null;
  unitIds: string[];
  fieldSeasonIds: string[];
  flagIds: string[];
}

export interface SeasonStore {
  /** The farm and the fields on its map. Null if no farm is set up. */
  loadFarm(): Promise<{ insuredId: string; fields: MappedField[] } | null>;
  findDocumentByHash(hash: string): Promise<SavedDocument | null>;
  loadDocument(id: string): Promise<SavedDocument | null>;
  /** Stores the original file. Storing bytes that are already there is not an error. */
  saveFile(path: string, file: Uint8Array, type: DocumentFileType): Promise<void>;
  insertDocument(document: NewDocument): Promise<SavedDocument>;
  /** The policy already on record for this crop, county and year, if there is one. */
  findPolicy(insuredId: string, policy: { crop: string; state: string; county: string; crop_year: number }): Promise<{ id: string } | null>;
  insertPolicy(policy: NewPolicy): Promise<{ id: string }>;
  insertUnits(units: NewUnit[]): Promise<{ id: string; unit_number: string }[]>;
  insertFieldSeasons(fieldSeasons: NewFieldSeason[]): Promise<{ id: string }[]>;
  insertFlags(flags: NewFlag[]): Promise<{ id: string }[]>;
  confirmDocuments(ids: string[], who: Role, at: string): Promise<void>;
  /** Removes what a setup wrote, children first. */
  removeSeason(written: WrittenSeason): Promise<void>;
}

export interface SeasonSetupDeps {
  store: SeasonStore;
  readFsa578(file: Uint8Array): Promise<ReadResult<Fsa578Read>>;
  readSummaryOfCoverage(file: Uint8Array): Promise<ReadResult<SummaryOfCoverageRead>>;
  /** The time and GPS a photo carries. */
  captureInfo(photo: Uint8Array): Promise<CaptureInfo>;
  now(): Date;
}

// ---------------------------------------------------------------------------
// Step 1: read the two documents
// ---------------------------------------------------------------------------

export type ReadSeasonOutcome =
  | {
      status: "ready";
      /** The saved documents the proposal was worked out from. Confirming names these. */
      documents: { fsa578Id: string; coverageId: string };
      proposal: SeasonProposal;
      /** Checks on the read values that didn't add up: one sentence each, to look at before confirming. */
      warnings: string[];
    }
  /** No season can be set up from these files. One plain sentence per reason. */
  | { status: "not_ready"; messages: string[] };

const notReady = (...messages: string[]): ReadSeasonOutcome => ({ status: "not_ready", messages });

const ewktPoint = ({ longitude, latitude }: { longitude: number; latitude: number }) =>
  `SRID=4326;POINT(${longitude} ${latitude})`;

interface KindOf<T> {
  kind: SeasonDocumentKind;
  parse(values: unknown): T | null;
  check(values: T): DocumentCheck[];
  read(deps: SeasonSetupDeps, file: Uint8Array): Promise<ReadResult<T>>;
}

const FSA_578: KindOf<Fsa578Read> = {
  kind: "fsa_578",
  parse: (values) => fsa578ReadSchema.safeParse(values).data ?? null,
  check: checkFsa578,
  read: (deps, file) => deps.readFsa578(file),
};

const COVERAGE: KindOf<SummaryOfCoverageRead> = {
  kind: "summary_of_coverage",
  parse: (values) => summaryOfCoverageReadSchema.safeParse(values).data ?? null,
  check: checkSummaryOfCoverage,
  read: (deps, file) => deps.readSummaryOfCoverage(file),
};

type Added<T> = { ok: true; id: string; values: T; checks: DocumentCheck[] } | { ok: false; message: string };

/** Saves one file as a document, reading it first unless this exact file was read before. */
async function addDocument<T>(
  what: KindOf<T>,
  file: Uint8Array,
  type: DocumentFileType,
  insuredId: string,
  who: Role,
  deps: SeasonSetupDeps,
): Promise<Added<T>> {
  const title = TITLES[what.kind];
  const hash = sha256Hex(file);

  const before = await deps.store.findDocumentByHash(hash);
  if (before) {
    if (before.kind !== what.kind) {
      const other = TITLES[before.kind as SeasonDocumentKind] ?? "another document";
      return { ok: false, message: `The file you chose as your ${title} was added before as your ${other}. Choose your ${title}.` };
    }
    const values = what.parse(before.readValues);
    if (values) return { ok: true, id: before.id, values, checks: before.readChecks };
    return { ok: false, message: `Your ${title} was added before but couldn't be read then. Take a new photo of it and add that.` };
  }

  const read = await what.read(deps, file);
  if (!read.ok) {
    return { ok: false, message: `Your ${title} couldn't be read. Try a clearer photo, with the whole page flat and in the frame.` };
  }
  const checks = what.check(read.values);
  // A PDF carries no camera time or GPS.
  const capture = type.mediaType === "application/pdf" ? { capturedAt: null, location: null } : await deps.captureInfo(file);

  const path = documentFilePath(hash, type);
  await deps.store.saveFile(path, file, type);
  const saved = await deps.store.insertDocument({
    insured_id: insuredId,
    kind: what.kind,
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

const failedChecks = (checks: readonly DocumentCheck[]) => checks.filter((c) => c.status === "fail").map((c) => c.message);

function alreadySetUp(policy: SeasonProposal["policy"]): string {
  return `Your ${policy.crop_year} ${policy.crop} season in ${policy.county} County is already set up.`;
}

export async function readSeasonDocuments(
  files: { fsa578: Uint8Array; coverage: Uint8Array },
  role: Role,
  deps: SeasonSetupDeps,
): Promise<ReadSeasonOutcome> {
  if (role !== "farmer") return notReady("Only the farmer sets up a season. Switch to Farmer to do it.");

  const types = { fsa578: documentFileType(files.fsa578), coverage: documentFileType(files.coverage) };
  const wrongType = [
    ...(types.fsa578 ? [] : ["Your FSA-578 must be a JPEG or PNG photo, or a PDF."]),
    ...(types.coverage ? [] : ["Your Summary of Coverage must be a PDF, or a JPEG or PNG photo."]),
  ];
  if (wrongType.length > 0 || !types.fsa578 || !types.coverage) return notReady(...wrongType);
  if (sha256Hex(files.fsa578) === sha256Hex(files.coverage)) {
    return notReady("You chose the same file twice. Choose your FSA-578 and your Summary of Coverage.");
  }

  const farm = await deps.store.loadFarm();
  if (!farm) return notReady("Your farm isn't set up yet, so there are no fields to set a season up for.");

  // The two reads don't depend on each other, so they run together.
  const [fsa578, coverage] = await Promise.all([
    addDocument(FSA_578, files.fsa578, types.fsa578, farm.insuredId, role, deps),
    addDocument(COVERAGE, files.coverage, types.coverage, farm.insuredId, role, deps),
  ]);
  if (!fsa578.ok || !coverage.ok) {
    return notReady(...[fsa578, coverage].flatMap((added) => (added.ok ? [] : [added.message])));
  }

  const setup = proposeSeason(fsa578.values, coverage.values, farm.fields);
  if (!setup.ok) return notReady(...setup.problems);
  if (await deps.store.findPolicy(farm.insuredId, setup.proposal.policy)) return notReady(alreadySetUp(setup.proposal.policy));

  return {
    status: "ready",
    documents: { fsa578Id: fsa578.id, coverageId: coverage.id },
    proposal: setup.proposal,
    warnings: [...failedChecks(fsa578.checks), ...failedChecks(coverage.checks)],
  };
}

// ---------------------------------------------------------------------------
// Step 2: the farmer confirms
// ---------------------------------------------------------------------------

export type ConfirmSeasonOutcome =
  | { status: "set_up"; proposal: SeasonProposal }
  | { status: "not_set_up"; messages: string[] };

const notSetUp = (...messages: string[]): ConfirmSeasonOutcome => ({ status: "not_set_up", messages });

const READ_AGAIN = "Those documents can't be found any more. Add your FSA-578 and Summary of Coverage again.";

function flagRecord(
  flag: ProposedFlag,
  unitIds: Map<string, string>,
  fsa578DocumentId: string,
): Pick<NewFlag, "record_type" | "record_id"> {
  switch (flag.about.record) {
    case "unit": {
      const id = unitIds.get(flag.about.unitNumber);
      if (!id) throw new Error(`A flag is about Unit ${flag.about.unitNumber}, which wasn't saved.`);
      return { record_type: "unit", record_id: id };
    }
    case "field":
      return { record_type: "field", record_id: flag.about.fieldId };
    case "fsa_578":
      return { record_type: "document", record_id: fsa578DocumentId };
  }
}

export async function confirmSeason(
  documents: { fsa578Id: string; coverageId: string },
  role: Role,
  deps: Pick<SeasonSetupDeps, "store" | "now">,
): Promise<ConfirmSeasonOutcome> {
  if (role !== "farmer") return notSetUp("Only the farmer sets up a season. Switch to Farmer to do it.");
  const { store } = deps;

  const [fsaDocument, coverageDocument, farm] = await Promise.all([
    store.loadDocument(documents.fsa578Id),
    store.loadDocument(documents.coverageId),
    store.loadFarm(),
  ]);
  if (!farm) return notSetUp("Your farm isn't set up yet, so there are no fields to set a season up for.");
  if (fsaDocument?.kind !== "fsa_578" || coverageDocument?.kind !== "summary_of_coverage") return notSetUp(READ_AGAIN);
  const fsa578 = FSA_578.parse(fsaDocument.readValues);
  const coverage = COVERAGE.parse(coverageDocument.readValues);
  if (!fsa578 || !coverage) return notSetUp(READ_AGAIN);

  // Worked out again from what is saved: the browser only said which documents.
  const setup = proposeSeason(fsa578, coverage, farm.fields);
  if (!setup.ok) return notSetUp(...setup.problems);
  const { proposal } = setup;
  const { policy } = proposal;
  if (await store.findPolicy(farm.insuredId, policy)) return notSetUp(alreadySetUp(policy));

  const written: WrittenSeason = { policyId: null, unitIds: [], fieldSeasonIds: [], flagIds: [] };
  try {
    written.policyId = (await store.insertPolicy({ insured_id: farm.insuredId, ...policy })).id;

    const units = await store.insertUnits(
      proposal.units.map((unit) => ({
        policy_id: written.policyId!,
        unit_number: unit.unitNumber,
        unit_type: unit.unitType,
        practice: unit.practice,
        share_arrangement: unit.shareArrangement,
        insured_share: unit.insuredShare,
      })),
    );
    written.unitIds = units.map((unit) => unit.id);
    const unitIds = new Map(units.map((unit) => [unit.unit_number, unit.id]));

    const fieldSeason = (field: ProposedFieldSeason, unitId: string | null): NewFieldSeason => ({
      field_id: field.fieldId,
      unit_id: unitId,
      crop_year: policy.crop_year,
      crop: field.crop,
      planted_acres: field.plantedAcres,
      planting_date: field.plantingDate,
      practice: field.practice,
      insured: unitId !== null,
    });
    const fieldSeasons = await store.insertFieldSeasons([
      ...proposal.units.flatMap((unit) => {
        const unitId = unitIds.get(unit.unitNumber);
        if (!unitId) throw new Error(`Unit ${unit.unitNumber} wasn't saved.`);
        return unit.fields.map((field) => fieldSeason(field, unitId));
      }),
      // A field on the FSA-578 that no unit covers is kept, with no unit and not insured.
      ...proposal.uninsuredFields.map((field) => fieldSeason(field, null)),
    ]);
    written.fieldSeasonIds = fieldSeasons.map((fieldSeason) => fieldSeason.id);

    const bothDocuments = [fsaDocument.id, coverageDocument.id].map((id) => ({ type: "document" as const, id }));
    const flags = await store.insertFlags(
      proposal.flags.map((flag) => ({
        flag_type: flag.type,
        severity: "warn" as const,
        message: flag.message,
        ...flagRecord(flag, unitIds, fsaDocument.id),
        related: [...flag.fieldIds.map((id) => ({ type: "field" as const, id })), ...bothDocuments],
        created_by: role,
      })),
    );
    written.flagIds = flags.map((flag) => flag.id);

    await store.confirmDocuments([fsaDocument.id, coverageDocument.id], role, deps.now().toISOString());
  } catch (error) {
    // The REST API has no transactions, so take back out whatever went in.
    await store.removeSeason(written).catch((undoError: unknown) => {
      console.error("Removing a half-written season failed:", undoError instanceof Error ? undoError.message : undoError);
    });
    throw error;
  }

  return { status: "set_up", proposal };
}
