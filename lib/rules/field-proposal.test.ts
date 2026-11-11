import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { loadSampleFiles } from "../../scripts/seed/sample-files";
import { loadSampleOutlines } from "../fields/nearby-outlines";
import { fsaFieldKey, proposeFieldsFromMap, type ExistingField, type FieldProposal, type ProposalMap } from "./field-proposal";
import type { MapSpot } from "./outline-pairing";

// The SAMPLE FSA map as printed in the answer key, the sample outlines file, and Dave's fields and bins.
const MAP: ProposalMap = documentsOfKind(loadDocumentsFile(), "fsa_map")[0][1].values;
const OUTLINES = await loadSampleOutlines();
const sample = loadSampleFiles();
const [NORTH_80, SOUTH_40] = sample.fields;
const [binLongitude, binLatitude] = sample.farm.bins[0].location;
const FARMSTEAD: MapSpot = { longitude: binLongitude, latitude: binLatitude };

const existing = (name: string, tract: string, field: string): ExistingField => ({
  id: `field-${name}`,
  name,
  fsa_farm: "1234",
  fsa_tract: tract,
  fsa_field: field,
});
const propose = (map: ProposalMap = MAP, fields: ExistingField[] = [], click = FARMSTEAD): FieldProposal => {
  const result = proposeFieldsFromMap(map, OUTLINES, click, fields);
  if (!result.ok) throw new Error(`expected a proposal, got: ${result.problems.join(" ")}`);
  return result.proposal;
};
const problems = (map: ProposalMap) => {
  const result = proposeFieldsFromMap(map, OUTLINES, FARMSTEAD, []);
  if (result.ok) throw new Error("expected problems");
  return result.problems;
};
/** The sample map with one more field in tract 5678. */
const withField = (line: ProposalMap["tracts"][number]["fields"][number]): ProposalMap => ({
  ...MAP,
  tracts: [{ ...MAP.tracts[0], fields: [...MAP.tracts[0].fields, line] }, MAP.tracts[1]],
});

describe("the sample FSA map on an empty farm", () => {
  const proposal = propose();

  it("proposes North 80 and South 40, with their FSA numbers, printed acres and outlines", () => {
    expect(proposal.fields).toEqual([
      {
        key: "1234/5678/3",
        fsaFarm: "1234",
        fsaTract: "5678",
        fsaField: "3",
        fsaMapAcres: 80.2,
        hel: "NHEL",
        outlineId: NORTH_80.id,
        outline: NORTH_80.geometry.coordinates,
        outlineAcres: 80.2,
        defaultName: "North 80",
      },
      {
        key: "1234/6012/1",
        fsaFarm: "1234",
        fsaTract: "6012",
        fsaField: "1",
        fsaMapAcres: 40,
        hel: "NHEL",
        outlineId: SOUTH_40.id,
        outline: SOUTH_40.geometry.coordinates,
        outlineAcres: 40,
        defaultName: "South 40",
      },
    ]);
  });

  it("carries the map's farm, state, county and section label", () => {
    expect(proposal).toMatchObject({
      farmNumber: "1234",
      state: "IA",
      county: "Story",
      legalDescription: "SAMPLE: Sec. 14 T84N R23W",
      alreadyOnMap: [],
      unpaired: [],
      notCropland: 0,
    });
  });
});

describe("fields the farm already has", () => {
  it("leaves a field with the same FSA numbers as it is, and says so", () => {
    const proposal = propose(MAP, [existing("Home 80", "5678", "3")]);
    expect(proposal.fields.map((f) => f.key)).toEqual(["1234/6012/1"]);
    expect(proposal.alreadyOnMap).toEqual(["Field 3 on tract 5678 is already on your map as Home 80, so it is left as it is."]);
  });

  it("proposes nothing when the farm has every field on the map", () => {
    const proposal = propose(MAP, [existing("North 80", "5678", "3"), existing("South 40", "6012", "1")]);
    expect(proposal.fields).toEqual([]);
    expect(proposal.alreadyOnMap).toHaveLength(2);
    expect(proposal.unpaired).toEqual([]);
  });

  it("says a field is already on the map even when no outline fits it now", () => {
    const proposal = propose(MAP, [existing("North 80", "5678", "3")], { longitude: -92.9, latitude: 41.6 });
    expect(proposal.alreadyOnMap).toEqual(["Field 3 on tract 5678 is already on your map as North 80, so it is left as it is."]);
    expect(proposal.unpaired).toHaveLength(1);
    expect(proposal.unpaired[0]).toContain("Field 1 on tract 6012");
  });

  it("matches FSA numbers whatever the spaces around them", () => {
    expect(fsaFieldKey(" 1234", "5678 ", " 3 ")).toBe("1234/5678/3");
    expect(fsaFieldKey("1234", null, "3")).toBeNull();
    const proposal = propose(MAP, [{ ...existing("North 80", " 5678 ", "3 ") }]);
    expect(proposal.fields.map((f) => f.key)).toEqual(["1234/6012/1"]);
  });

  it("doesn't offer a new field a name the farm already uses", () => {
    // Another field, with other FSA numbers, already has the name the north field would be offered.
    const proposal = propose(MAP, [existing("North 80", "9999", "7")]);
    expect(proposal.fields.map((f) => f.defaultName)).toEqual(["Field 3", "South 40"]);
  });
});

describe("fields that can't be proposed", () => {
  it("lists a field with no fitting outline with its reason, and still proposes the rest", () => {
    const proposal = propose(withField({ field: "4", acres: 12.5, hel: "HEL", land_use: "cropland" }));
    expect(proposal.fields.map((f) => f.key)).toEqual(["1234/5678/3", "1234/6012/1"]);
    expect(proposal.unpaired).toEqual([
      "Field 4 on tract 5678 (12.50 acres) wasn't matched to an outline because no outline within 2 km of where you clicked measures within 1% of its acres.",
    ]);
  });

  it("leaves out what isn't cropland, and counts it", () => {
    const proposal = propose(withField({ field: "5", acres: 3.1, hel: null, land_use: "non_cropland" }));
    expect(proposal.fields).toHaveLength(2);
    expect(proposal.unpaired).toEqual([]);
    expect(proposal.notCropland).toBe(1);
  });

  it("proposes nothing, with a reason for each field, from a click far from the farm", () => {
    const proposal = propose(MAP, [], { longitude: -92.9, latitude: 41.6 });
    expect(proposal.fields).toEqual([]);
    expect(proposal.unpaired).toHaveLength(2);
  });
});

describe("a map that can't be used", () => {
  it("needs at least one field", () => {
    expect(problems({ ...MAP, tracts: [] })).toEqual([
      "No fields could be read from that photo. Try a clearer one, with the whole map flat and in the frame.",
    ]);
    expect(problems({ ...MAP, tracts: MAP.tracts.map((tract) => ({ ...tract, fields: [] })) })).toHaveLength(1);
  });

  it("needs the state and county, which every field is saved with", () => {
    expect(problems({ ...MAP, county: null })).toEqual([
      "The map's county couldn't be read from its heading, so its fields can't be added. Try a clearer photo, with the heading in the frame.",
    ]);
    expect(problems({ ...MAP, state: null, county: null })[0]).toContain("The map's state and county couldn't be read");
  });

  it("is still used without a section label", () => {
    expect(propose({ ...MAP, plss_label: null }).legalDescription).toBeNull();
  });
});
