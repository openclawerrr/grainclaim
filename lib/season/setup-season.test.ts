import { describe, expect, it } from "vitest";
import documents from "../../sample-data/documents-2026.json";
import { loadSampleFiles } from "../../scripts/seed/sample-files";
import { fsa578ReadSchema, type Fsa578Read } from "../extract/fsa-578-schema";
import type { ReadResult } from "../extract/read";
import type { SeenKind } from "../rules/document-kind";
import { summaryOfCoverageReadSchema, type SummaryOfCoverageRead } from "../extract/summary-of-coverage-schema";
import { sha256Hex, type CaptureInfo } from "../photos/photo-file";
import type { MappedField } from "../rules/season-setup";
import {
  confirmSeason,
  readSeasonDocuments,
  type NewDocument,
  type NewFieldSeason,
  type NewFlag,
  type NewPolicy,
  type NewUnit,
  type SavedDocument,
  type SeasonSetupDeps,
  type SeasonStore,
  type WrittenSeason,
} from "./setup-season";

// The sample documents' printed values stand in for what Claude reads.
const FSA: Fsa578Read = fsa578ReadSchema.parse(documents.documents["fsa-578"].values);
const COVERAGE: SummaryOfCoverageRead = summaryOfCoverageReadSchema.parse(documents.documents["summary-of-coverage"].values);
const sample = loadSampleFiles();
const FIELDS: MappedField[] = sample.fields.map((f) => ({
  id: f.id,
  name: f.properties.name,
  fsa_farm: f.properties.fsa_farm,
  fsa_tract: f.properties.fsa_tract,
  fsa_field: f.properties.fsa_field,
  mapped_acres: f.properties.expected_acres,
}));
const [NORTH, SOUTH] = FIELDS;

const FSA_PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const COVERAGE_PDF = new TextEncoder().encode("%PDF-1.7 summary");
const FILES = { fsa578: FSA_PHOTO, coverage: COVERAGE_PDF };
/** A photo of the FSA map: a different document, which doesn't belong in either slot. */
const MAP_PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 9]);
const NOW = new Date("2026-06-15T15:00:00Z");
const CAPTURE: CaptureInfo = { capturedAt: "2026-06-15T09:58:00-05:00", location: { longitude: -93.43, latitude: 42.093 } };

/** A stand-in for the database, backed by arrays, that can be told to fail at one step. */
function fakeStore(options: { farm?: boolean; fields?: MappedField[]; failAt?: keyof SeasonStore } = {}) {
  const saved = {
    files: [] as { path: string; mediaType: string }[],
    documents: [] as (NewDocument & { id: string; confirmed_by?: string; confirmed_at?: string })[],
    policies: [] as (NewPolicy & { id: string })[],
    units: [] as (NewUnit & { id: string })[],
    fieldSeasons: [] as (NewFieldSeason & { id: string })[],
    flags: [] as (NewFlag & { id: string })[],
    removed: [] as WrittenSeason[],
  };
  const failing = (step: keyof SeasonStore) => {
    if (options.failAt === step) throw new Error(`${step} failed: connection lost`);
  };
  const asSaved = (d: (typeof saved.documents)[number]): SavedDocument => ({
    id: d.id,
    kind: d.kind,
    readValues: d.read_values,
    readChecks: d.read_checks,
  });
  const store: SeasonStore = {
    async loadFarm() {
      return options.farm === false ? null : { insuredId: "insured-1", fields: options.fields ?? FIELDS };
    },
    async findDocumentByHash(hash) {
      const found = saved.documents.find((d) => d.file_sha256 === hash);
      return found ? asSaved(found) : null;
    },
    async loadDocument(id) {
      const found = saved.documents.find((d) => d.id === id);
      return found ? asSaved(found) : null;
    },
    async saveFile(path, _file, type) {
      failing("saveFile");
      saved.files.push({ path, mediaType: type.mediaType });
    },
    async insertDocument(document) {
      failing("insertDocument");
      // The two documents are saved side by side, so the id says which one it is, not which came first.
      const row = { ...document, id: `doc-${document.kind === "fsa_578" ? "fsa" : "coverage"}` };
      saved.documents.push(row);
      return asSaved(row);
    },
    async findPolicy(insuredId, policy) {
      return (
        saved.policies.find(
          (p) =>
            p.insured_id === insuredId &&
            p.crop === policy.crop &&
            p.state === policy.state &&
            p.county === policy.county &&
            p.crop_year === policy.crop_year,
        ) ?? null
      );
    },
    async insertPolicy(policy) {
      failing("insertPolicy");
      const row = { ...policy, id: `policy-${saved.policies.length + 1}` };
      saved.policies.push(row);
      return row;
    },
    async insertUnits(units) {
      failing("insertUnits");
      const rows = units.map((unit, i) => ({ ...unit, id: `unit-${saved.units.length + i + 1}` }));
      saved.units.push(...rows);
      return rows;
    },
    async insertFieldSeasons(fieldSeasons) {
      failing("insertFieldSeasons");
      const rows = fieldSeasons.map((fs, i) => ({ ...fs, id: `fs-${saved.fieldSeasons.length + i + 1}` }));
      saved.fieldSeasons.push(...rows);
      return rows;
    },
    async insertFlags(flags) {
      failing("insertFlags");
      const rows = flags.map((flag, i) => ({ ...flag, id: `flag-${saved.flags.length + i + 1}` }));
      saved.flags.push(...rows);
      return rows;
    },
    async confirmDocuments(ids, who, at) {
      failing("confirmDocuments");
      for (const document of saved.documents) {
        if (ids.includes(document.id)) Object.assign(document, { confirmed_by: who, confirmed_at: at });
      }
    },
    async removeSeason(written) {
      saved.removed.push(structuredClone(written));
      saved.flags = saved.flags.filter((r) => !written.flagIds.includes(r.id));
      saved.fieldSeasons = saved.fieldSeasons.filter((r) => !written.fieldSeasonIds.includes(r.id));
      saved.units = saved.units.filter((r) => !written.unitIds.includes(r.id));
      saved.policies = saved.policies.filter((r) => r.id !== written.policyId);
    },
  };
  return { store, saved };
}

const readOk = <T,>(values: T): ReadResult<T> => ({
  ok: true,
  values,
  model: "haiku",
  effort: "medium",
  seconds: 3,
  usage: { input_tokens: 8000, output_tokens: 400 },
});
const readFailed = <T,>(): ReadResult<T> => ({
  ok: false,
  reason: "The answer was cut off before it finished.",
  model: "haiku",
  effort: "medium",
  seconds: 3,
  usage: { input_tokens: 8000, output_tokens: 16000 },
});

/** What the reader says of a file that isn't the kind it expects. */
const readWrongKind = <T,>(wrongKind: SeenKind): ReadResult<T> => ({
  ok: false,
  reason: `The file is ${wrongKind}.`,
  wrongKind,
  model: "haiku",
  effort: "medium",
  seconds: 3,
  usage: { input_tokens: 8000, output_tokens: 60 },
});

/** A reader's answer, the same for every file or worked out from the file it is handed. */
type Reads<T> = ReadResult<T> | ((file: Uint8Array) => ReadResult<T>);
const answerFor = <T,>(reads: Reads<T> | undefined, file: Uint8Array, otherwise: T): ReadResult<T> =>
  typeof reads === "function" ? reads(file) : (reads ?? readOk(otherwise));

function setup(options: Parameters<typeof fakeStore>[0] & { fsa?: Reads<Fsa578Read>; coverage?: Reads<SummaryOfCoverageRead> } = {}) {
  const { store, saved } = fakeStore(options);
  const reads = { fsa578: 0, coverage: 0, captureInfo: 0 };
  const deps: SeasonSetupDeps = {
    store,
    readFsa578: async (file) => {
      reads.fsa578 += 1;
      return answerFor(options.fsa, file, FSA);
    },
    readSummaryOfCoverage: async (file) => {
      reads.coverage += 1;
      return answerFor(options.coverage, file, COVERAGE);
    },
    captureInfo: async () => {
      reads.captureInfo += 1;
      return CAPTURE;
    },
    now: () => NOW,
  };
  return { deps, saved, reads };
}

/** Reads the sample documents and returns what confirming needs. */
async function ready(context: ReturnType<typeof setup>) {
  const outcome = await readSeasonDocuments(FILES, "farmer", context.deps);
  if (outcome.status !== "ready") throw new Error(`not ready: ${outcome.messages.join(" | ")}`);
  return outcome;
}

describe("readSeasonDocuments", () => {
  it("reads both documents, saves each with its file and read values, and proposes the season", async () => {
    const context = setup();
    const outcome = await ready(context);

    expect(outcome.documents).toEqual({ fsa578Id: "doc-fsa", coverageId: "doc-coverage" });
    expect(outcome.proposal.units.map((u) => [u.unitNumber, Math.round(u.guaranteeBu)])).toEqual([
      ["1", 10_827],
      ["2", 3_600],
    ]);
    expect(outcome.proposal.flags.map((f) => f.type)).toEqual(["acre_mismatch"]);
    expect(outcome.warnings).toEqual([]);

    expect([...context.saved.files].sort((a, b) => a.mediaType.localeCompare(b.mediaType))).toEqual([
      { path: `documents/${sha256Hex(COVERAGE_PDF)}.pdf`, mediaType: "application/pdf" },
      { path: `documents/${sha256Hex(FSA_PHOTO)}.jpg`, mediaType: "image/jpeg" },
    ]);
    expect([...context.saved.documents].sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      {
        id: "doc-fsa",
        insured_id: "insured-1",
        kind: "fsa_578",
        file_path: `documents/${sha256Hex(FSA_PHOTO)}.jpg`,
        file_sha256: sha256Hex(FSA_PHOTO),
        media_type: "image/jpeg",
        captured_at: "2026-06-15T09:58:00-05:00",
        capture_location: "SRID=4326;POINT(-93.43 42.093)",
        uploaded_by: "farmer",
        read_values: FSA,
        read_checks: expect.arrayContaining([expect.objectContaining({ id: "acres_total", status: "pass" })]),
        read_model: "claude-haiku-5-5",
        read_at: "2026-06-15T15:00:00.000Z",
      },
      expect.objectContaining({
        id: "doc-coverage",
        kind: "summary_of_coverage",
        media_type: "application/pdf",
        // A PDF carries no camera time or GPS, and isn't asked for one.
        captured_at: null,
        capture_location: null,
        read_values: COVERAGE,
      }),
    ]);
    expect(context.reads).toEqual({ fsa578: 1, coverage: 1, captureInfo: 1 });
  });

  it("writes no season until the farmer confirms", async () => {
    const context = setup();
    await ready(context);
    expect([context.saved.policies, context.saved.units, context.saved.fieldSeasons, context.saved.flags]).toEqual([[], [], [], []]);
    expect(context.saved.documents.every((d) => d.confirmed_at === undefined)).toBe(true);
  });

  it("doesn't read a file again that was already added: it uses the saved reading", async () => {
    const context = setup();
    const first = await ready(context);
    const second = await ready(context);
    expect(second).toEqual(first);
    expect(context.saved.documents).toHaveLength(2);
    expect(context.reads).toEqual({ fsa578: 1, coverage: 1, captureInfo: 1 });
  });

  it("passes on failed checks as sentences to look at before confirming", async () => {
    // The operator total misread: 120.20 as 126.20.
    const context = setup({ fsa: readOk({ ...FSA, total_operator_report: 126.2 }) });
    const outcome = await ready(context);
    expect(outcome.warnings).toEqual([
      "The operator total reads 126.2 acres, but the fields' reported acres add up to 120.2.",
    ]);
    // The season is still proposed: the total isn't one of the values it is made from.
    expect(outcome.proposal.units.map((u) => Math.round(u.guaranteeBu))).toEqual([10_827, 3_600]);
  });

  it("says so when a document can't be read, and saves nothing for it", async () => {
    const context = setup({ fsa: readFailed() });
    expect(await readSeasonDocuments(FILES, "farmer", context.deps)).toEqual({
      status: "not_ready",
      messages: [],
      files: { fsa578: "Your FSA-578 couldn't be read. Try a clearer photo, with the whole page flat and in the frame." },
    });
    // The Summary of Coverage read fine and is kept, so it isn't read again next time.
    expect(context.saved.documents.map((d) => d.kind)).toEqual(["summary_of_coverage"]);
  });

  it("gives the rules' reasons when the documents don't make a season", async () => {
    const context = setup({ fsa: readOk({ ...FSA, program_year: 2025 }) });
    expect(await readSeasonDocuments(FILES, "farmer", context.deps)).toEqual({
      status: "not_ready",
      messages: ["The FSA-578 is for 2025 but the Summary of Coverage is for 2026. Add the two for the same year."],
    });
  });

  it("refuses files that aren't a photo or a PDF, before anything is read", async () => {
    const context = setup();
    const text = new TextEncoder().encode("acres.xlsx");
    expect(await readSeasonDocuments({ fsa578: text, coverage: text }, "farmer", context.deps)).toEqual({
      status: "not_ready",
      messages: [],
      files: {
        fsa578: "Your FSA-578 must be a JPEG or PNG photo, or a PDF.",
        coverage: "Your Summary of Coverage must be a PDF, or a JPEG or PNG photo.",
      },
    });
    expect(context.reads).toEqual({ fsa578: 0, coverage: 0, captureInfo: 0 });
  });

  it("refuses the same file chosen for both, and a file that was added before as the other document", async () => {
    const context = setup();
    expect(await readSeasonDocuments({ fsa578: FSA_PHOTO, coverage: FSA_PHOTO }, "farmer", context.deps)).toEqual({
      status: "not_ready",
      messages: ["You chose the same file twice. Choose your FSA-578 and your Summary of Coverage."],
    });
    await ready(context);
    const other = new Uint8Array([0xff, 0xd8, 0xff, 2]);
    expect(await readSeasonDocuments({ fsa578: COVERAGE_PDF, coverage: other }, "farmer", context.deps)).toMatchObject({
      status: "not_ready",
      messages: [],
      files: { fsa578: "This file was added before as your Summary of Coverage. Choose your FSA-578." },
    });
  });

  it("names the kind a file was added before as, whatever kind that is", async () => {
    const context = setup();
    // The FSA map, added on the farm map, then chosen here as the FSA-578.
    context.saved.documents.push({ id: "doc-map", kind: "fsa_map", file_sha256: sha256Hex(MAP_PHOTO) } as never);
    expect(await readSeasonDocuments({ fsa578: MAP_PHOTO, coverage: COVERAGE_PDF }, "farmer", context.deps)).toMatchObject({
      files: { fsa578: "This file was added before as your FSA map. Choose your FSA-578." },
    });
    expect(context.reads.fsa578).toBe(0);
  });

  it("is the farmer's job, and needs a farm", async () => {
    const context = setup();
    expect(await readSeasonDocuments(FILES, "agent", context.deps)).toEqual({
      status: "not_ready",
      messages: ["Only the farmer sets up a season. Switch to Farmer to do it."],
    });
    expect(context.reads.fsa578).toBe(0);
    expect(await readSeasonDocuments(FILES, "farmer", setup({ farm: false }).deps)).toEqual({
      status: "not_ready",
      messages: ["Your farm isn't set up yet, so there are no fields to set a season up for."],
    });
  });
});

describe("readSeasonDocuments: a file that isn't the kind its slot is for", () => {
  /** The FSA-578 reader, handed the FSA map photo, says it is an FSA map; any other file reads as the sample FSA-578. */
  const mapIsAMap = (file: Uint8Array) => (sha256Hex(file) === sha256Hex(MAP_PHOTO) ? readWrongKind<Fsa578Read>("fsa_map") : readOk(FSA));
  const mapAsFsa578 = { fsa578: MAP_PHOTO, coverage: COVERAGE_PDF };

  it("reads the right kinds as before", async () => {
    const context = setup({ fsa: mapIsAMap });
    expect((await ready(context)).documents).toEqual({ fsa578Id: "doc-fsa", coverageId: "doc-coverage" });
  });

  it("refuses an FSA map chosen as the FSA-578, by name, in that file's slot", async () => {
    const context = setup({ fsa: mapIsAMap });
    expect(await readSeasonDocuments(mapAsFsa578, "farmer", context.deps)).toEqual({
      status: "not_ready",
      messages: [],
      files: { fsa578: "This looks like an FSA map, not an FSA-578. Choose your FSA-578." },
    });
  });

  it("saves nothing of the refused file: no file, no document row, and it isn't remembered", async () => {
    const context = setup({ fsa: mapIsAMap });
    await readSeasonDocuments(mapAsFsa578, "farmer", context.deps);

    const mapHash = sha256Hex(MAP_PHOTO);
    expect(context.saved.files.some((file) => file.path.includes(mapHash))).toBe(false);
    expect(context.saved.documents.some((document) => document.file_sha256 === mapHash)).toBe(false);
    expect(await context.deps.store.findDocumentByHash(mapHash)).toBeNull();
    expect([context.saved.policies, context.saved.units, context.saved.fieldSeasons, context.saved.flags]).toEqual([[], [], [], []]);
    // Its capture time and GPS weren't even looked at.
    expect(context.reads.captureInfo).toBe(0);
  });

  it("keeps the right-kind file in the other slot, so a second try doesn't read it again", async () => {
    const context = setup({ fsa: mapIsAMap });
    await readSeasonDocuments(mapAsFsa578, "farmer", context.deps);
    expect(context.saved.documents.map((d) => d.kind)).toEqual(["summary_of_coverage"]);

    // He replaces only the wrong file and reads again.
    const second = await readSeasonDocuments(FILES, "farmer", context.deps);
    expect(second).toMatchObject({ status: "ready", documents: { fsa578Id: "doc-fsa", coverageId: "doc-coverage" } });
    expect(context.saved.documents.map((d) => d.kind).sort()).toEqual(["fsa_578", "summary_of_coverage"]);
    expect(context.reads).toMatchObject({ fsa578: 2, coverage: 1 });
  });

  it("refuses each of two wrong files in its own slot, and saves nothing at all", async () => {
    const context = setup({ fsa: readWrongKind("scale_ticket"), coverage: readWrongKind("fsa_578") });
    expect(await readSeasonDocuments(FILES, "farmer", context.deps)).toEqual({
      status: "not_ready",
      messages: [],
      files: {
        fsa578: "This looks like a scale ticket, not an FSA-578. Choose your FSA-578.",
        coverage: "This looks like an FSA-578, not a Summary of Coverage. Choose your Summary of Coverage.",
      },
    });
    expect(context.saved.files).toEqual([]);
    expect(context.saved.documents).toEqual([]);
  });

  it("refuses a file that is none of the kinds, without guessing a name for it", async () => {
    const context = setup({ coverage: readWrongKind("other") });
    expect(await readSeasonDocuments(FILES, "farmer", context.deps)).toMatchObject({
      files: { coverage: "This doesn't look like a Summary of Coverage. Choose your Summary of Coverage." },
    });
    expect(context.saved.documents.map((d) => d.kind)).toEqual(["fsa_578"]);
  });
});

describe("confirmSeason", () => {
  it("writes the policy, Units 1 and 2, their field seasons and the one acre flag", async () => {
    const context = setup();
    const { documents: ids } = await ready(context);
    const outcome = await confirmSeason(ids, "farmer", context.deps);

    expect(outcome.status).toBe("set_up");
    // The same policy the seed loads, under its own id.
    expect(context.saved.policies).toEqual([{ ...sample.season.policy, id: "policy-1", insured_id: "insured-1" }]);
    expect(context.saved.units).toEqual([
      { id: "unit-1", policy_id: "policy-1", unit_number: "1", unit_type: "basic", practice: "non-irrigated", share_arrangement: "owned", insured_share: 1 },
      { id: "unit-2", policy_id: "policy-1", unit_number: "2", unit_type: "basic", practice: "non-irrigated", share_arrangement: "crop_share", insured_share: 0.6667 },
    ]);
    expect(context.saved.fieldSeasons).toEqual([
      { id: "fs-1", field_id: NORTH.id, unit_id: "unit-1", crop_year: 2026, crop: "corn", planted_acres: 80.2, planting_date: "2026-04-28", practice: "non-irrigated", insured: true },
      { id: "fs-2", field_id: SOUTH.id, unit_id: "unit-2", crop_year: 2026, crop: "corn", planted_acres: 40, planting_date: "2026-04-28", practice: "non-irrigated", insured: true },
    ]);
    expect(context.saved.flags).toEqual([
      {
        id: "flag-1",
        flag_type: "acre_mismatch",
        severity: "warn",
        message:
          "North 80: your FSA-578 shows 80.20 acres, but your Summary of Coverage shows 80.00. Your map measures 80.20. Tell your agent before harvest.",
        record_type: "field",
        record_id: NORTH.id,
        related: [
          { type: "field", id: NORTH.id },
          { type: "document", id: "doc-fsa" },
          { type: "document", id: "doc-coverage" },
        ],
        created_by: "farmer",
      },
    ]);
    expect(context.saved.documents).toHaveLength(2);
    expect(context.saved.documents.map((d) => [d.confirmed_by, d.confirmed_at])).toEqual([
      ["farmer", "2026-06-15T15:00:00.000Z"],
      ["farmer", "2026-06-15T15:00:00.000Z"],
    ]);
    expect(context.saved.removed).toEqual([]);
  });

  it("returns the season it set up, with the guarantees", async () => {
    const context = setup();
    const { documents: ids, proposal } = await ready(context);
    expect(await confirmSeason(ids, "farmer", context.deps)).toEqual({ status: "set_up", proposal });
  });

  it("works the season out from the saved documents, whatever the browser held", async () => {
    const context = setup();
    const { documents: ids } = await ready(context);
    // Only the two ids cross over: there is nowhere to send acres, shares or a guarantee.
    expect(Object.keys(ids)).toEqual(["fsa578Id", "coverageId"]);
    await confirmSeason(ids, "farmer", context.deps);
    expect(context.saved.fieldSeasons.map((fs) => fs.planted_acres)).toEqual([80.2, 40]);
  });

  it("refuses a second season for the same crop, county and year", async () => {
    const context = setup();
    const { documents: ids } = await ready(context);
    await confirmSeason(ids, "farmer", context.deps);
    const already = "Your 2026 corn season in Story County is already set up.";
    expect(await confirmSeason(ids, "farmer", context.deps)).toEqual({ status: "not_set_up", messages: [already] });
    expect(await readSeasonDocuments(FILES, "farmer", context.deps)).toEqual({ status: "not_ready", messages: [already] });
    expect(context.saved.policies).toHaveLength(1);
    expect(context.saved.units).toHaveLength(2);
  });

  it("refuses documents it can't find, or given the wrong way round", async () => {
    const context = setup();
    const { documents: ids } = await ready(context);
    const again = "Those documents can't be found any more. Add your FSA-578 and Summary of Coverage again.";
    expect(await confirmSeason({ fsa578Id: "gone", coverageId: ids.coverageId }, "farmer", context.deps)).toEqual({
      status: "not_set_up",
      messages: [again],
    });
    expect(await confirmSeason({ fsa578Id: ids.coverageId, coverageId: ids.fsa578Id }, "farmer", context.deps)).toEqual({
      status: "not_set_up",
      messages: [again],
    });
    expect(context.saved.policies).toEqual([]);
  });

  it("checks the map again: a field removed since the reading stops the setup", async () => {
    const reading = setup();
    const { documents: ids } = await ready(reading);
    // The same saved documents, but South 40 is no longer on the map.
    const later = fakeStore({ fields: [NORTH] });
    later.saved.documents.push(...reading.saved.documents);
    expect(await confirmSeason(ids, "farmer", { store: later.store, now: () => NOW })).toEqual({
      status: "not_set_up",
      messages: ["Unit 2 covers FSA farm 1234, tract 6012, field 1, which isn't on your farm map. Add that field to the map first."],
    });
    expect(later.saved.policies).toEqual([]);
  });

  it("is the farmer's job", async () => {
    const context = setup();
    const { documents: ids } = await ready(context);
    expect(await confirmSeason(ids, "agent", context.deps)).toEqual({
      status: "not_set_up",
      messages: ["Only the farmer sets up a season. Switch to Farmer to do it."],
    });
    expect(context.saved.policies).toEqual([]);
  });

  it.each(["insertUnits", "insertFieldSeasons", "insertFlags", "confirmDocuments"] as const)(
    "takes back out what it wrote when %s fails, and passes the failure on",
    async (step) => {
      const reading = setup();
      const { documents: ids } = await ready(reading);
      const failing = fakeStore({ failAt: step });
      failing.saved.documents.push(...reading.saved.documents);

      await expect(confirmSeason(ids, "farmer", { store: failing.store, now: () => NOW })).rejects.toThrow(`${step} failed: connection lost`);
      expect(failing.saved.removed).toHaveLength(1);
      expect(failing.saved.removed[0].policyId).toBe("policy-1");
      expect([failing.saved.policies, failing.saved.units, failing.saved.fieldSeasons, failing.saved.flags]).toEqual([[], [], [], []]);
      expect(failing.saved.documents.every((d) => d.confirmed_at === undefined)).toBe(true);
    },
  );

  it("writes nothing when the policy itself can't be saved", async () => {
    const reading = setup();
    const { documents: ids } = await ready(reading);
    const failing = fakeStore({ failAt: "insertPolicy" });
    failing.saved.documents.push(...reading.saved.documents);
    await expect(confirmSeason(ids, "farmer", { store: failing.store, now: () => NOW })).rejects.toThrow("insertPolicy failed");
    expect(failing.saved.removed).toEqual([{ policyId: null, unitIds: [], fieldSeasonIds: [], flagIds: [] }]);
  });

  it("attaches a flag about a field to the field, and one about the FSA-578 to that document", async () => {
    const west: MappedField = { id: "west-20", name: "West 20", fsa_farm: "1234", fsa_tract: "5678", fsa_field: "7", mapped_acres: 20 };
    const extraLine = { ...FSA.fields[0], tract: "9001", field: "2", reported_acres: 15 };
    const context = setup({ fields: [...FIELDS, west], fsa: readOk({ ...FSA, fields: [...FSA.fields, extraLine] }) });
    const { documents: ids } = await ready(context);
    await confirmSeason(ids, "farmer", context.deps);
    expect(context.saved.flags.map((f) => [f.flag_type, f.record_type, f.record_id])).toEqual([
      ["field_not_on_map", "document", "doc-fsa"],
      ["unreported_field", "field", "west-20"],
      ["acre_mismatch", "field", NORTH.id],
    ]);
  });

  it("writes two field seasons for a unit with two fields, and attaches a tract's acre flag to the unit", async () => {
    const east: MappedField = { id: "east-40", name: "East 40", fsa_farm: "1234", fsa_tract: "5678", fsa_field: "4", mapped_acres: 40.3 };
    const fsa = { ...FSA, fields: [...FSA.fields, { ...FSA.fields[0], field: "4", reported_acres: 40.3 }] };
    // One row for Unit 1 covers all of tract 5678, at 120.00 acres against the FSA-578's 120.50.
    const coverage = { ...COVERAGE, units: [{ ...COVERAGE.units[0], fsa_field: null, acres: 120 }, COVERAGE.units[1]] };
    const context = setup({ fields: [...FIELDS, east], fsa: readOk(fsa), coverage: readOk(coverage) });
    const { documents: ids, proposal } = await ready(context);
    expect(proposal.units[0].guaranteeBu).toBeCloseTo(16_267.5, 9);

    await confirmSeason(ids, "farmer", context.deps);
    expect(context.saved.units.map((u) => u.unit_number)).toEqual(["1", "2"]);
    expect(context.saved.fieldSeasons.map((fs) => [fs.field_id, fs.unit_id, fs.planted_acres, fs.insured])).toEqual([
      [NORTH.id, "unit-1", 80.2, true],
      ["east-40", "unit-1", 40.3, true],
      [SOUTH.id, "unit-2", 40, true],
    ]);
    expect(context.saved.flags.map((f) => [f.flag_type, f.record_type, f.record_id, f.related.filter((r) => r.type === "field").map((r) => r.id)])).toEqual([
      ["acre_mismatch", "unit", "unit-1", [NORTH.id, "east-40"]],
    ]);
  });

  it("keeps a field that is in no unit: a field season with no unit, not insured, and the flag for the agent", async () => {
    const west: MappedField = { id: "west-20", name: "West 20", fsa_farm: "1234", fsa_tract: "9001", fsa_field: "7", mapped_acres: 20 };
    const line = { ...FSA.fields[0], tract: "9001", field: "7", reported_acres: 20, planting_date: "2026-05-04" };
    const context = setup({ fields: [...FIELDS, west], fsa: readOk({ ...FSA, fields: [...FSA.fields, line] }) });
    const { documents: ids } = await ready(context);
    await confirmSeason(ids, "farmer", context.deps);

    expect(context.saved.fieldSeasons).toEqual([
      expect.objectContaining({ field_id: NORTH.id, unit_id: "unit-1", insured: true }),
      expect.objectContaining({ field_id: SOUTH.id, unit_id: "unit-2", insured: true }),
      { id: "fs-3", field_id: "west-20", unit_id: null, crop_year: 2026, crop: "corn", planted_acres: 20, planting_date: "2026-05-04", practice: "non-irrigated", insured: false },
    ]);
    // Every row fits the database's rule: insured seasons have a unit, uninsured ones don't.
    for (const fs of context.saved.fieldSeasons) expect(fs.insured).toBe(fs.unit_id !== null);
    expect(context.saved.units).toHaveLength(2);
    expect(context.saved.flags.map((f) => [f.flag_type, f.record_type, f.record_id])).toEqual([
      ["uninsured_field", "field", "west-20"],
      ["acre_mismatch", "field", NORTH.id],
    ]);
  });
});
