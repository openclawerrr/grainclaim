import { describe, expect, it } from "vitest";
import documents from "../../sample-data/documents-2026.json";
import { loadSampleFiles } from "../../scripts/seed/sample-files";
import { fsaMapReadSchema, type FsaMapRead } from "../extract/fsa-map-schema";
import type { ReadResult } from "../extract/read";
import { sha256Hex, type CaptureInfo } from "../photos/photo-file";
import type { Role } from "../role/role";
import type { ExistingField } from "../rules/field-proposal";
import type { MapSpot, PublicOutline } from "../rules/outline-pairing";
import {
  confirmFields,
  ewktPolygon,
  readFsaMapPhoto,
  type AddFieldsDeps,
  type ConfirmFieldsInput,
  type FieldStore,
  type NewField,
  type NewFsaMapDocument,
  type SavedDocument,
} from "./add-fields";
import { loadSampleOutlines } from "./nearby-outlines";

// The sample map's printed values stand in for what Claude reads, and the sample outlines file for the public outlines.
const MAP: FsaMapRead = fsaMapReadSchema.parse(documents.documents["fsa-map"].values);
const OUTLINES = await loadSampleOutlines();
const sample = loadSampleFiles();
const [NORTH_80, SOUTH_40] = sample.fields;
const [binLongitude, binLatitude] = sample.farm.bins[0].location;
const FARMSTEAD: MapSpot = { longitude: binLongitude, latitude: binLatitude };
const FAR_AWAY: MapSpot = { longitude: -92.9, latitude: 41.6 };

const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 7]);
const PDF = new TextEncoder().encode("%PDF-1.7 fsa map");
const NOW = new Date("2026-04-20T15:00:00Z");
const CAPTURE: CaptureInfo = { capturedAt: "2026-04-20T09:58:00-05:00", location: { longitude: -93.43, latitude: 42.093 } };
const NORTH_KEY = "1234/5678/3";
const SOUTH_KEY = "1234/6012/1";

type DocumentRow = { id: string; kind: string; file_sha256: string; read_values: unknown; read_checks: SavedDocument["readChecks"] } & Partial<
  Omit<NewFsaMapDocument, "kind" | "file_sha256" | "read_values" | "read_checks">
> & { confirmed_by?: string; confirmed_at?: string };

/** A stand-in for the database, backed by arrays, that can be told to fail at one step. */
function fakeStore(options: { farm?: boolean; fields?: ExistingField[]; documents?: DocumentRow[]; failAt?: keyof FieldStore } = {}) {
  const saved = {
    files: [] as { path: string; mediaType: string }[],
    documents: [...(options.documents ?? [])],
    fields: [] as (NewField & { id: string })[],
    removed: [] as string[][],
  };
  const existing = [...(options.fields ?? [])];
  const failing = (step: keyof FieldStore) => {
    if (options.failAt === step) throw new Error(`${step} failed: connection lost`);
  };
  const asSaved = (d: DocumentRow): SavedDocument => ({ id: d.id, kind: d.kind, readValues: d.read_values, readChecks: d.read_checks });
  const store: FieldStore = {
    async loadFarm() {
      return options.farm === false ? null : { insuredId: "insured-1", fields: existing };
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
      const row = { ...document, id: `doc-${saved.documents.length + 1}` };
      saved.documents.push(row);
      return asSaved(row);
    },
    async insertFields(fields) {
      failing("insertFields");
      const rows = fields.map((field, i) => ({ ...field, id: `field-${saved.fields.length + i + 1}` }));
      saved.fields.push(...rows);
      // The farm has them from now on, as it would in the database.
      existing.push(...rows.map((row) => ({ id: row.id, name: row.name, fsa_farm: row.fsa_farm, fsa_tract: row.fsa_tract, fsa_field: row.fsa_field })));
      return rows.map((row) => ({ id: row.id, name: row.name, acres: row.fsa_map_acres, outline: [] }));
    },
    async confirmDocuments(ids, who, at) {
      failing("confirmDocuments");
      for (const document of saved.documents) {
        if (ids.includes(document.id)) Object.assign(document, { confirmed_by: who, confirmed_at: at });
      }
    },
    async removeFields(ids) {
      saved.removed.push(ids);
      saved.fields = saved.fields.filter((field) => !ids.includes(field.id));
    },
  };
  return { store, saved };
}

const readOk = (values: FsaMapRead): ReadResult<FsaMapRead> => ({
  ok: true,
  values,
  model: "haiku",
  effort: "medium",
  seconds: 4,
  usage: { input_tokens: 3000, output_tokens: 400 },
});
const readFailed: ReadResult<FsaMapRead> = {
  ok: false,
  reason: "The model returned no values.",
  model: "haiku",
  effort: "medium",
  seconds: 4,
  usage: { input_tokens: 3000, output_tokens: 0 },
};

function setUp(options: Parameters<typeof fakeStore>[0] & { read?: ReadResult<FsaMapRead>; outlines?: PublicOutline[] } = {}) {
  const { store, saved } = fakeStore(options);
  const calls = { reads: 0, captures: 0, outlineSpots: [] as MapSpot[] };
  const deps: AddFieldsDeps = {
    store,
    async readFsaMap() {
      calls.reads += 1;
      return options.read ?? readOk(MAP);
    },
    async captureInfo() {
      calls.captures += 1;
      return CAPTURE;
    },
    async outlinesNear(spot) {
      calls.outlineSpots.push(spot);
      return options.outlines ?? OUTLINES;
    },
    now: () => NOW,
  };
  return { deps, saved, calls };
}

async function ready(deps: AddFieldsDeps, file = PHOTO, click = FARMSTEAD, role: Role = "farmer") {
  const outcome = await readFsaMapPhoto(file, click, role, deps);
  if (outcome.status !== "ready") throw new Error(`expected ready, got: ${outcome.messages.join(" ")}`);
  return outcome;
}
async function notReady(deps: AddFieldsDeps, file = PHOTO, click = FARMSTEAD, role: Role = "farmer") {
  const outcome = await readFsaMapPhoto(file, click, role, deps);
  if (outcome.status !== "not_ready") throw new Error("expected not_ready");
  return outcome.messages;
}
/** What the screen sends back when the farmer confirms what he was shown, with the names it offered unless he typed others. */
function confirmation(shown: Awaited<ReturnType<typeof ready>>, names: Record<string, string> = {}): ConfirmFieldsInput {
  return {
    documentId: shown.documentId,
    click: shown.click,
    fields: shown.proposal.fields.map((field) => ({ key: field.key, outlineId: field.outlineId, name: names[field.key] ?? field.defaultName })),
  };
}

describe("reading the FSA map photo", () => {
  it("proposes North 80 and South 40 from the sample map, with their outlines, and writes no field", async () => {
    const { deps, saved, calls } = setUp();
    const outcome = await ready(deps);
    expect(outcome.proposal.fields.map((f) => [f.defaultName, f.key, f.fsaMapAcres, f.outlineId, f.outlineAcres])).toEqual([
      ["North 80", NORTH_KEY, 80.2, NORTH_80.id, 80.2],
      ["South 40", SOUTH_KEY, 40, SOUTH_40.id, 40],
    ]);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.click).toEqual(FARMSTEAD);
    expect(saved.fields).toEqual([]);
    expect(calls.outlineSpots).toEqual([FARMSTEAD]);
  });

  it("saves the photo as an fsa_map document: hashed, with its read values and checks, by the farmer", async () => {
    const { deps, saved } = setUp();
    const outcome = await ready(deps);
    const hash = sha256Hex(PHOTO);
    expect(saved.files).toEqual([{ path: `documents/${hash}.jpg`, mediaType: "image/jpeg" }]);
    expect(saved.documents).toHaveLength(1);
    expect(saved.documents[0]).toMatchObject({
      id: outcome.documentId,
      insured_id: "insured-1",
      kind: "fsa_map",
      file_path: `documents/${hash}.jpg`,
      file_sha256: hash,
      media_type: "image/jpeg",
      captured_at: CAPTURE.capturedAt,
      capture_location: "SRID=4326;POINT(-93.43 42.093)",
      uploaded_by: "farmer",
      read_values: MAP,
      read_model: "claude-haiku-5-5",
      read_at: NOW.toISOString(),
    });
    expect(saved.documents[0].read_checks.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(saved.documents[0].confirmed_by).toBeUndefined();
  });

  it("takes the map as a PDF, which carries no camera time or GPS", async () => {
    const { deps, saved, calls } = setUp();
    await ready(deps, PDF);
    expect(saved.documents[0]).toMatchObject({ media_type: "application/pdf", captured_at: null, capture_location: null });
    expect(saved.files[0].path).toBe(`documents/${sha256Hex(PDF)}.pdf`);
    expect(calls.captures).toBe(0);
  });

  it("doesn't read the same photo twice: the saved reading is used", async () => {
    const { deps, saved, calls } = setUp();
    const first = await ready(deps);
    const again = await ready(deps);
    expect(calls.reads).toBe(1);
    expect(saved.documents).toHaveLength(1);
    expect(again.documentId).toBe(first.documentId);
    expect(again.proposal).toEqual(first.proposal);
  });

  it("shows a failed check as a warning to look at before confirming", async () => {
    const off: FsaMapRead = { ...MAP, tracts: [{ ...MAP.tracts[0], cropland_acres: 82 }, MAP.tracts[1]] };
    const { deps } = setUp({ read: readOk(off) });
    const outcome = await ready(deps);
    expect(outcome.warnings).toEqual(["Tract 1234/5678's cropland total reads 82 acres, but its cropland fields add up to 80.2."]);
    expect(outcome.proposal.fields).toHaveLength(2);
  });

  it("says which fields the farm already has, and proposes only the rest", async () => {
    const north: ExistingField = { id: "f-north", name: "North 80", fsa_farm: "1234", fsa_tract: "5678", fsa_field: "3" };
    const { deps } = setUp({ fields: [north] });
    const outcome = await ready(deps);
    expect(outcome.proposal.fields.map((f) => f.key)).toEqual([SOUTH_KEY]);
    expect(outcome.proposal.alreadyOnMap).toEqual(["Field 3 on tract 5678 is already on your map as North 80, so it is left as it is."]);
  });

  it("proposes nothing from a click far from the farm, with one sentence per field, and still keeps the document", async () => {
    const { deps, saved } = setUp();
    const outcome = await ready(deps, PHOTO, FAR_AWAY);
    expect(outcome.proposal.fields).toEqual([]);
    expect(outcome.proposal.unpaired).toHaveLength(2);
    expect(saved.documents).toHaveLength(1);
  });

  describe("what stops it", () => {
    it("is the farmer's job", async () => {
      const { deps, saved, calls } = setUp();
      expect(await notReady(deps, PHOTO, FARMSTEAD, "agent")).toEqual(["Only the farmer adds fields. Switch to Farmer to add them."]);
      expect(calls.reads).toBe(0);
      expect(saved.documents).toEqual([]);
    });

    it("needs a JPEG, PNG or PDF", async () => {
      const { deps, calls } = setUp();
      expect(await notReady(deps, new TextEncoder().encode("GIF89a"))).toEqual(["Your FSA map must be a JPEG or PNG photo, or a PDF."]);
      expect(calls.reads).toBe(0);
    });

    it("needs a click that is a place on the earth, before anything is read", async () => {
      const { deps, calls } = setUp();
      for (const click of [{ longitude: Number.NaN, latitude: 42 }, { longitude: -200, latitude: 42 }, { longitude: -93, latitude: 91 }]) {
        expect(await notReady(deps, PHOTO, click)).toEqual(["Click the map roughly where your farm is."]);
      }
      expect(calls.reads).toBe(0);
    });

    it("needs a farm", async () => {
      const { deps, calls } = setUp({ farm: false });
      expect(await notReady(deps)).toEqual(["Your farm isn't set up yet, so there is nowhere to add fields."]);
      expect(calls.reads).toBe(0);
    });

    it("saves nothing when the photo can't be read", async () => {
      const { deps, saved } = setUp({ read: readFailed });
      expect(await notReady(deps)).toEqual(["Your FSA map couldn't be read. Try a clearer photo, with the whole map flat and in the frame."]);
      expect(saved.documents).toEqual([]);
      expect(saved.files).toEqual([]);
    });

    it("says so when the file was added before as another document", async () => {
      const fsa578: DocumentRow = { id: "doc-578", kind: "fsa_578", file_sha256: sha256Hex(PHOTO), read_values: {}, read_checks: [] };
      const { deps, calls } = setUp({ documents: [fsa578] });
      expect(await notReady(deps)).toEqual(["The file you chose was added before as your FSA-578. Choose a photo of your FSA map."]);
      expect(calls.reads).toBe(0);
    });

    it("asks for a new photo when the saved reading can't be used", async () => {
      const broken: DocumentRow = { id: "doc-map", kind: "fsa_map", file_sha256: sha256Hex(PHOTO), read_values: null, read_checks: [] };
      const { deps } = setUp({ documents: [broken] });
      expect(await notReady(deps)).toEqual(["Your FSA map was added before but couldn't be read then. Take a new photo of it and add that."]);
    });

    it("keeps the document but proposes nothing when the map's county wasn't read", async () => {
      const { deps, saved } = setUp({ read: readOk({ ...MAP, county: null }) });
      expect((await notReady(deps))[0]).toContain("The map's county couldn't be read");
      expect(saved.documents).toHaveLength(1);
    });

    it("throws when the database fails, so the screen can say something went wrong", async () => {
      const { deps } = setUp({ failAt: "insertDocument" });
      await expect(readFsaMapPhoto(PHOTO, FARMSTEAD, "farmer", deps)).rejects.toThrow("insertDocument failed");
    });
  });
});

describe("confirming the fields", () => {
  it("writes each field with its outline, FSA numbers, state, county, section label and a link to the document", async () => {
    const { deps, saved } = setUp();
    const shown = await ready(deps);
    const outcome = await confirmFields(confirmation(shown), "farmer", deps);

    expect(outcome).toMatchObject({ status: "saved", skipped: [] });
    expect(outcome.status === "saved" && outcome.fields.map((f) => f.name)).toEqual(["North 80", "South 40"]);
    expect(saved.fields).toEqual([
      {
        id: "field-1",
        insured_id: "insured-1",
        name: "North 80",
        fsa_farm: "1234",
        fsa_tract: "5678",
        fsa_field: "3",
        state: "IA",
        county: "Story",
        boundary: ewktPolygon(NORTH_80.geometry.coordinates),
        legal_description: "SAMPLE: Sec. 14 T84N R23W",
        source: "ai_proposed",
        hel_status: "NHEL",
        cropland: true,
        fsa_map_acres: 80.2,
        fsa_map_document_id: shown.documentId,
      },
      {
        id: "field-2",
        insured_id: "insured-1",
        name: "South 40",
        fsa_farm: "1234",
        fsa_tract: "6012",
        fsa_field: "1",
        state: "IA",
        county: "Story",
        boundary: ewktPolygon(SOUTH_40.geometry.coordinates),
        legal_description: "SAMPLE: Sec. 14 T84N R23W",
        source: "ai_proposed",
        hel_status: "NHEL",
        cropland: true,
        fsa_map_acres: 40,
        fsa_map_document_id: shown.documentId,
      },
    ]);
  });

  it("marks the document confirmed by the farmer", async () => {
    const { deps, saved } = setUp();
    await confirmFields(confirmation(await ready(deps)), "farmer", deps);
    expect(saved.documents[0]).toMatchObject({ confirmed_by: "farmer", confirmed_at: NOW.toISOString() });
  });

  it("saves the names the farmer typed, tidied", async () => {
    const { deps, saved } = setUp();
    const shown = await ready(deps);
    await confirmFields(confirmation(shown, { [NORTH_KEY]: "  Home   place ", [SOUTH_KEY]: "Miller's" }), "farmer", deps);
    expect(saved.fields.map((f) => f.name)).toEqual(["Home place", "Miller's"]);
  });

  it("takes the outline from the server's own pairing, never from the browser", async () => {
    const { deps, saved, calls } = setUp();
    const shown = await ready(deps);
    await confirmFields(confirmation(shown), "farmer", deps);
    // The form has no outline in it to send: only which outline each field was shown with.
    expect(Object.keys(confirmation(shown).fields[0]).sort()).toEqual(["key", "name", "outlineId"]);
    expect(calls.outlineSpots).toEqual([FARMSTEAD, FARMSTEAD]);
    expect(saved.fields[0].boundary).toBe(ewktPolygon(NORTH_80.geometry.coordinates));
  });

  it("saves erodibility only as HEL or NHEL: undetermined and unmarked are left empty", async () => {
    const map: FsaMapRead = {
      ...MAP,
      tracts: [
        { ...MAP.tracts[0], fields: [{ ...MAP.tracts[0].fields[0], hel: "UHEL" }] },
        { ...MAP.tracts[1], fields: [{ ...MAP.tracts[1].fields[0], hel: null }] },
      ],
    };
    const { deps, saved } = setUp({ read: readOk(map) });
    await confirmFields(confirmation(await ready(deps)), "farmer", deps);
    expect(saved.fields.map((f) => f.hel_status)).toEqual([null, null]);
  });

  it("skips a field the farm got in the meantime, says so, and saves the rest", async () => {
    const { deps, saved } = setUp();
    const shown = await ready(deps);
    // Another tab confirms the same map first. It was shown only the north field: the south one had no outline there.
    const northOnly = { ...confirmation(shown), fields: confirmation(shown).fields.slice(0, 1) };
    const first = await confirmFields(northOnly, "farmer", {
      ...deps,
      outlinesNear: async () => OUTLINES.filter((outline) => outline.id !== SOUTH_40.id),
    });
    expect(first.status).toBe("saved");

    const outcome = await confirmFields(confirmation(shown), "farmer", deps);
    expect(outcome).toMatchObject({
      status: "saved",
      skipped: ["Field 3 on tract 5678 is already on your map as North 80, so it was skipped."],
    });
    expect(outcome.status === "saved" && outcome.fields.map((f) => f.name)).toEqual(["South 40"]);
    expect(saved.fields.map((f) => f.name)).toEqual(["North 80", "South 40"]);
  });

  it("saves nothing new when confirmed twice, and says each field was skipped", async () => {
    const { deps, saved } = setUp();
    const shown = await ready(deps);
    await confirmFields(confirmation(shown), "farmer", deps);
    const again = await confirmFields(confirmation(shown), "farmer", deps);
    expect(again).toEqual({
      status: "saved",
      fields: [],
      skipped: [
        "Field 3 on tract 5678 is already on your map as North 80, so it was skipped.",
        "Field 1 on tract 6012 is already on your map as South 40, so it was skipped.",
      ],
    });
    expect(saved.fields).toHaveLength(2);
  });

  describe("what stops it", () => {
    const notSaved = async (deps: AddFieldsDeps, input: ConfirmFieldsInput, role: Role = "farmer") => {
      const outcome = await confirmFields(input, role, deps);
      if (outcome.status !== "not_saved") throw new Error("expected not_saved");
      return outcome;
    };

    it("is the farmer's job", async () => {
      const { deps, saved } = setUp();
      const shown = await ready(deps);
      expect((await notSaved(deps, confirmation(shown), "agent")).messages).toEqual(["Only the farmer adds fields. Switch to Farmer to add them."]);
      expect(saved.fields).toEqual([]);
    });

    it("needs the document to be a saved FSA map", async () => {
      const fsa578: DocumentRow = { id: "doc-578", kind: "fsa_578", file_sha256: "a".repeat(64), read_values: MAP, read_checks: [] };
      const { deps, saved } = setUp({ documents: [fsa578] });
      const input = (documentId: string): ConfirmFieldsInput => ({ documentId, click: FARMSTEAD, fields: [] });
      expect((await notSaved(deps, input("no-such-document"))).messages).toEqual(["That FSA map can't be found any more. Add its photo again."]);
      expect((await notSaved(deps, input("doc-578"))).messages).toEqual(["That FSA map can't be found any more. Add its photo again."]);
      expect(saved.fields).toEqual([]);
    });

    it("needs every field a name", async () => {
      const { deps, saved } = setUp();
      const shown = await ready(deps);
      const outcome = await notSaved(deps, confirmation(shown, { [SOUTH_KEY]: "  " }));
      expect(outcome).toEqual({ status: "not_saved", messages: ["Give each field a name, such as North 80."], key: SOUTH_KEY });
      expect(saved.fields).toEqual([]);
    });

    it("won't give two new fields the same name", async () => {
      const { deps, saved } = setUp();
      const shown = await ready(deps);
      const outcome = await notSaved(deps, confirmation(shown, { [SOUTH_KEY]: "north 80" }));
      expect(outcome).toEqual({
        status: "not_saved",
        messages: ["You already have a field called North 80. Give this one a different name."],
        key: SOUTH_KEY,
      });
      expect(saved.fields).toEqual([]);
    });

    it("won't reuse the name of a field the farm already has", async () => {
      const other: ExistingField = { id: "f-other", name: "Home place", fsa_farm: "1234", fsa_tract: "9999", fsa_field: "7" };
      const { deps, saved } = setUp({ fields: [other] });
      const shown = await ready(deps);
      const outcome = await notSaved(deps, confirmation(shown, { [NORTH_KEY]: "Home Place" }));
      expect(outcome.messages).toEqual(["You already have a field called Home place. Give this one a different name."]);
      expect(outcome.key).toBe(NORTH_KEY);
      expect(saved.fields).toEqual([]);
    });

    it("saves nothing when a field would get a different outline than the one he was shown", async () => {
      const { deps, saved } = setUp();
      const shown = await ready(deps);
      const swapped = confirmation(shown);
      swapped.fields[0].outlineId = swapped.fields[1].outlineId;
      expect((await notSaved(deps, swapped)).messages).toEqual([
        "What matches your map has changed since you looked. Nothing was saved. Read your map again.",
      ]);
      expect(saved.fields).toEqual([]);
    });

    it("saves nothing when a field he wasn't shown would be added", async () => {
      const { deps, saved } = setUp();
      const shown = await ready(deps);
      const fewer = { ...confirmation(shown), fields: confirmation(shown).fields.slice(0, 1) };
      expect((await notSaved(deps, fewer)).messages[0]).toContain("has changed since you looked");
      expect(saved.fields).toEqual([]);
    });

    it("saves nothing when a field he was shown no longer has an outline", async () => {
      const { deps, saved } = setUp();
      const shown = await ready(deps);
      const moved = { ...confirmation(shown), click: FAR_AWAY };
      expect((await notSaved(deps, moved)).messages[0]).toContain("has changed since you looked");
      expect(saved.fields).toEqual([]);
    });

    it("takes the fields back out when marking the document confirmed fails", async () => {
      const { deps, saved } = setUp({ failAt: "confirmDocuments" });
      const shown = await ready(deps);
      await expect(confirmFields(confirmation(shown), "farmer", deps)).rejects.toThrow("confirmDocuments failed");
      expect(saved.removed).toEqual([["field-1", "field-2"]]);
      expect(saved.fields).toEqual([]);
    });

    it("writes nothing when saving the fields fails", async () => {
      const { deps, saved } = setUp({ failAt: "insertFields" });
      const shown = await ready(deps);
      await expect(confirmFields(confirmation(shown), "farmer", deps)).rejects.toThrow("insertFields failed");
      expect(saved.fields).toEqual([]);
      expect(saved.documents[0].confirmed_by).toBeUndefined();
    });
  });
});

describe("ewktPolygon", () => {
  it("writes the outer ring and any holes as PostGIS reads them", () => {
    expect(ewktPolygon([[[-93.4, 42.1], [-93.3, 42.1], [-93.3, 42.2], [-93.4, 42.1]]])).toBe(
      "SRID=4326;POLYGON((-93.4 42.1,-93.3 42.1,-93.3 42.2,-93.4 42.1))",
    );
    expect(ewktPolygon([[[0, 0], [4, 0], [4, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]])).toBe(
      "SRID=4326;POLYGON((0 0,4 0,4 4,0 0),(1 1,2 1,2 2,1 1))",
    );
  });

  it("writes the sample fields exactly as the seed does", async () => {
    const { ewktPolygon: seedPolygon } = await import("../../scripts/seed/sample-files");
    expect(ewktPolygon(NORTH_80.geometry.coordinates)).toBe(seedPolygon(NORTH_80.geometry.coordinates[0]));
  });
});
