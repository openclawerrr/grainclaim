import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import {
  fromFsaMapWire,
  fsaMapReadSchema,
  fsaMapValues,
  fsaMapWireSchema,
  type FsaMapRead,
  type FsaMapWire,
} from "./fsa-map-schema";
import { readFsaMap, validateFsaMap } from "./read-fsa-map";
import { sentValues } from "./wire-schema-testing";

const KEY = documentsOfKind(loadDocumentsFile(), "fsa_map")[0][1].values;

// The SAMPLE FSA map as Claude would return it from the photo: the state as the map prints it.
const WIRE: FsaMapWire = {
  program_year: 2026,
  farm_number: "1234",
  state: "Iowa",
  county: "Story",
  map_created_date: "2026-04-14",
  tracts: [
    { tract: "5678", cropland_acres: 80.2, fields: [{ field: "3", acres: 80.2, hel: "NHEL", land_use: "cropland" }] },
    { tract: "6012", cropland_acres: 40, fields: [{ field: "1", acres: 40, hel: "NHEL", land_use: "cropland" }] },
  ],
  plss_label: "SAMPLE: Sec. 14 T84N R23W",
  imagery_credit: "2023 NAIP imagery",
};

describe("the FSA map schema", () => {
  it("accepts the answer key as it is", () => {
    expect(fsaMapReadSchema.parse(KEY)).toEqual(KEY);
  });

  it("has the answer key's values at every level, and both schemas agree", () => {
    const names = (shape: object) => Object.keys(shape).sort();
    expect(names(fsaMapReadSchema.shape)).toEqual(names(KEY));
    expect(names(fsaMapWireSchema.shape)).toEqual(names(KEY));
    expect(names(fsaMapReadSchema.shape.tracts.element.shape)).toEqual(names(KEY.tracts[0]));
    expect(names(fsaMapWireSchema.shape.tracts.element.shape)).toEqual(names(KEY.tracts[0]));
    expect(names(fsaMapReadSchema.shape.tracts.element.shape.fields.element.shape)).toEqual(names(KEY.tracts[0].fields[0]));
    expect(names(fsaMapWireSchema.shape.tracts.element.shape.fields.element.shape)).toEqual(names(KEY.tracts[0].fields[0]));
  });

  it("has no coordinates: a photo of a map doesn't say where its fields are", () => {
    const paths = sentValues(fsaMapWireSchema).map((v) => v.path);
    expect(paths).toEqual([
      "program_year",
      "farm_number",
      "state",
      "county",
      "map_created_date",
      "tracts",
      "tracts[].tract",
      "tracts[].cropland_acres",
      "tracts[].fields",
      "tracts[].fields[].field",
      "tracts[].fields[].acres",
      "tracts[].fields[].hel",
      "tracts[].fields[].land_use",
      "plss_label",
      "imagery_credit",
    ]);
    for (const path of paths) expect(path).not.toMatch(/lon|lat|coord|geometry|outline|boundary|bbox|point|position/i);
  });

  it("lets every value be null and every table be empty", () => {
    const blank: FsaMapRead = {
      program_year: null,
      farm_number: null,
      state: null,
      county: null,
      map_created_date: null,
      tracts: [],
      plss_label: null,
      imagery_credit: null,
    };
    expect(fsaMapReadSchema.parse(blank)).toEqual(blank);
    const blankTract: FsaMapRead = {
      ...blank,
      tracts: [{ tract: null, cropland_acres: null, fields: [{ field: null, acres: null, hel: null, land_use: null }] }],
    };
    expect(fsaMapReadSchema.parse(blankTract)).toEqual(blankTract);
  });

  it("takes the date only as YYYY-MM-DD and the state only as two letters", () => {
    const read = validateFsaMap({ ...fromFsaMapWire(WIRE), map_created_date: "April 14, 2026" });
    expect(read).toEqual({ ok: false, reason: expect.stringContaining("map_created_date") });
    expect(read).toEqual({ ok: false, reason: expect.stringContaining("FSA map schema") });
    expect(validateFsaMap({ ...fromFsaMapWire(WIRE), state: "Iowa" })).toMatchObject({ ok: false });
  });
});

describe("what Claude fills in for an FSA map", () => {
  it("stays inside structured outputs' limit of 16 values that can be null", () => {
    const nullable = sentValues(fsaMapWireSchema).filter((v) => v.nullable);
    expect(nullable.map((v) => v.path)).toEqual([
      "program_year",
      "map_created_date",
      "tracts[].cropland_acres",
      "tracts[].fields[].acres",
    ]);
  });

  it("describes every value for the model, nested ones included", () => {
    const values = sentValues(fsaMapWireSchema);
    expect(values).toHaveLength(15);
    for (const value of values) expect(value.description, value.path).toBeTruthy();
  });

  it("describes where values sit and never what this sample's are", () => {
    const sent = JSON.stringify(sentValues(fsaMapWireSchema).map((v) => v.description));
    for (const answer of ["1234", "5678", "6012", "80.2", "Story", "Iowa", "2023", "Sec. 14", "T84N", "SAMPLE"]) {
      expect(sent, answer).not.toContain(answer);
    }
  });

  it("becomes the answer key when everything is there", () => {
    expect(validateFsaMap(fromFsaMapWire(WIRE))).toEqual({ ok: true, values: KEY });
  });

  it("stores the state as its two-letter code, whether the map prints the name or the code", () => {
    const state = (printed: string) => fromFsaMapWire({ ...WIRE, state: printed }).state;
    expect(["Iowa", "IOWA", " iowa ", "IA", "ia"].map(state)).toEqual(["IA", "IA", "IA", "IA", "IA"]);
    expect(state("North Dakota")).toBe("ND");
    expect(state("")).toBeNull();
    expect(state("Story")).toBeNull();
  });

  it('turns "", an unmarked code and a land use that isn\'t shown into null, and keeps the rows', () => {
    const blank: FsaMapWire = {
      ...WIRE,
      farm_number: " ",
      county: "",
      tracts: [
        { tract: "", cropland_acres: null, fields: [{ field: "", acres: null, hel: "unmarked", land_use: "not_shown" }] },
        WIRE.tracts[1],
      ],
      plss_label: "",
      imagery_credit: "",
    };
    const read = validateFsaMap(fromFsaMapWire(blank));
    expect(read.ok && read.values).toMatchObject({
      farm_number: null,
      county: null,
      tracts: [
        { tract: null, cropland_acres: null, fields: [{ field: null, acres: null, hel: null, land_use: null }] },
        { tract: "6012", cropland_acres: 40, fields: [{ field: "1", acres: 40, hel: "NHEL", land_use: "cropland" }] },
      ],
      plss_label: null,
      imagery_credit: null,
    });
  });
});

describe("the FSA map's values by name", () => {
  it("names all 19 values, tracts by farm and tract number and fields by farm, tract and field number", () => {
    const values = fsaMapValues(KEY);
    expect(values.map((v) => v.label)).toEqual([
      "program_year",
      "farm_number",
      "state",
      "county",
      "map_created_date",
      "tract 1234/5678: tract",
      "tract 1234/5678: cropland_acres",
      "field 1234/5678/3: field",
      "field 1234/5678/3: acres",
      "field 1234/5678/3: hel",
      "field 1234/5678/3: land_use",
      "tract 1234/6012: tract",
      "tract 1234/6012: cropland_acres",
      "field 1234/6012/1: field",
      "field 1234/6012/1: acres",
      "field 1234/6012/1: hel",
      "field 1234/6012/1: land_use",
      "plss_label",
      "imagery_credit",
    ]);
    expect(values.find((v) => v.label === "field 1234/5678/3: acres")!.value).toBe(80.2);
    expect(values.find((v) => v.label === "state")!.value).toBe("IA");
  });

  it("compares the PLSS label and imagery credit as wording, and everything else exactly", () => {
    expect(fsaMapValues(KEY).filter((v) => v.wording).map((v) => v.label)).toEqual(["plss_label", "imagery_credit"]);
  });

  it("gives a row the same names whatever order the tracts are in", () => {
    const reversed = { ...KEY, tracts: [...KEY.tracts].reverse() };
    const byLabel = (map: FsaMapRead) => new Map(fsaMapValues(map).map((v) => [v.label, v.value]));
    expect(byLabel(reversed)).toEqual(byLabel(KEY));
  });

  it("names a field by the tract it was read in, so a field read into the wrong tract scores as wrong", () => {
    const swapped = { ...KEY, tracts: [{ ...KEY.tracts[0], fields: KEY.tracts[1].fields }, { ...KEY.tracts[1], fields: KEY.tracts[0].fields }] };
    const labels = fsaMapValues(swapped).map((v) => v.label);
    expect(labels).toContain("field 1234/5678/1: acres");
    expect(labels).not.toContain("field 1234/5678/3: acres");
  });
});

describe("readFsaMap", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  /** A stand-in for the API that records what it was sent and answers with the sample map. */
  function fakeClient() {
    const sent: Anthropic.MessageCreateParams[] = [];
    const client = {
      messages: {
        parse: async (params: Anthropic.MessageCreateParams) => {
          sent.push(params);
          return { stop_reason: "end_turn", usage: { input_tokens: 5000, output_tokens: 300 }, parsed_output: WIRE };
        },
      },
    } as unknown as Anthropic;
    return { client, sent };
  }

  it("sends the photo with the map prompt and returns the answer key's values", async () => {
    const { client, sent } = fakeClient();
    const result = await readFsaMap(JPEG, { model: "haiku", client });
    expect(result).toMatchObject({ ok: true, model: "haiku", values: KEY });

    expect(sent).toHaveLength(1);
    expect(sent[0].messages[0].content).toMatchObject([{ type: "image" }, { type: "text", text: "Read this FSA map." }]);
    const system = String(sent[0].system);
    expect(system).toContain("You read FSA aerial maps");
    expect(system).toContain("Copy each value exactly as it appears on the document.");
    expect(system).toContain("A field belongs to the tract whose boundary surrounds it.");
  });

  it("gives the same prompt whatever the farm: it names none of this sample's values", async () => {
    const { client, sent } = fakeClient();
    await readFsaMap(JPEG, { model: "sonnet", client });
    for (const answer of ["1234", "5678", "6012", "80.2", "Story", "Iowa", "2023", "T84N", "SAMPLE"]) {
      expect(String(sent[0].system), answer).not.toContain(answer);
    }
  });

  it("refuses a file that isn't a photo or a PDF", async () => {
    await expect(readFsaMap(new TextEncoder().encode("a map"), { model: "haiku", client: fakeClient().client })).rejects.toThrow(
      "An FSA map must be a JPEG or PNG photo, or a PDF.",
    );
  });
});
