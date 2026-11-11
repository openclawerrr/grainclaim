import { describe, expect, it } from "vitest";
import { databaseAcres } from "../../scripts/outlines/acres";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { loadSampleFiles } from "../../scripts/seed/sample-files";
import { loadSampleOutlines } from "../fields/nearby-outlines";
import {
  acresFit,
  fieldWords,
  metersFromOutline,
  NEARBY_METERS,
  pairFieldsWithOutlines,
  type FieldPairing,
  type MapSpot,
  type PairingMap,
  type PublicOutline,
} from "./outline-pairing";

// The SAMPLE FSA map as printed in the answer key, the sample outlines file, and Dave's fields and bins.
const MAP: PairingMap = documentsOfKind(loadDocumentsFile(), "fsa_map")[0][1].values;
const OUTLINES = await loadSampleOutlines();
const sample = loadSampleFiles();
const [NORTH_80, SOUTH_40] = sample.fields;
const [binLongitude, binLatitude] = sample.farm.bins[0].location;
const FARMSTEAD: MapSpot = { longitude: binLongitude, latitude: binLatitude };

/** A rectangle with its south-west corner at a spot, so many meters wide and tall (near enough, at Dave's latitude). */
function rectangle(id: string, west: number, south: number, widthMeters: number, heightMeters: number): PublicOutline {
  const east = west + widthMeters / 82_600;
  const north = south + heightMeters / 111_100;
  return { id, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}
const HERE: MapSpot = { longitude: -93.42, latitude: 42.09 };
/** About 40 acres, 100 m east of HERE. */
const FORTY = rectangle("forty", -93.4188, 42.09, 402, 402);
/** About 80 acres, north of FORTY. */
const EIGHTY = rectangle("eighty", -93.4188, 42.095, 804, 402);
const FORTY_ACRES = databaseAcres(FORTY);
const EIGHTY_ACRES = databaseAcres(EIGHTY);

type Line = PairingMap["tracts"][number]["fields"][number];
const line = (field: string | null, acres: number | null, more: Partial<Line> = {}): Line => ({
  field,
  acres,
  hel: "NHEL",
  land_use: "cropland",
  ...more,
});
/** A map of farm 1234 with one tract, 5678, holding these fields. */
const oneTract = (...fields: Line[]): PairingMap => ({ farm_number: "1234", tracts: [{ tract: "5678", fields }] });
const pair = (map: PairingMap, outlines: PublicOutline[], click = HERE) => pairFieldsWithOutlines(map, outlines, click);
const unpaired = (pairing: FieldPairing) => {
  if (pairing.paired) throw new Error("expected an unpaired field");
  return pairing;
};

describe("the sample FSA map and the sample outlines", () => {
  const result = pairFieldsWithOutlines(MAP, OUTLINES, FARMSTEAD);

  it("pairs field 3 with the North 80 outline and field 1 with the South 40 outline", () => {
    expect(result.pairings).toHaveLength(2);
    expect(result.pairings.map((p) => (p.paired ? [p.farm, p.tract, p.field, p.acres, p.outline.id, p.outlineAcres] : p.message))).toEqual([
      ["1234", "5678", "3", 80.2, NORTH_80.id, 80.2],
      ["1234", "6012", "1", 40, SOUTH_40.id, 40],
    ]);
  });

  it("gives each field its outline point for point", () => {
    const [north, south] = result.pairings;
    expect(north.paired && north.outline.coordinates).toEqual(NORTH_80.geometry.coordinates);
    expect(south.paired && south.outline.coordinates).toEqual(SOUTH_40.geometry.coordinates);
  });

  it("leaves every neighbor unpaired", () => {
    const used = result.pairings.flatMap((p) => (p.paired ? [p.outline.id] : []));
    const neighbors = OUTLINES.filter((outline) => outline.id !== NORTH_80.id && outline.id !== SOUTH_40.id);
    expect(neighbors).toHaveLength(6);
    expect(neighbors.filter((outline) => used.includes(outline.id))).toEqual([]);
    expect(result.outlinesNearby).toBe(8);
    expect(result.notCropland).toBe(0);
  });

  it("pairs the same way from a click in either field", () => {
    for (const field of [NORTH_80, SOUTH_40]) {
      const [longitude, latitude] = field.geometry.coordinates[0][0];
      const pairs = pairFieldsWithOutlines(MAP, OUTLINES, { longitude, latitude }).pairings;
      expect(pairs.map((p) => p.paired && p.outline.id)).toEqual([NORTH_80.id, SOUTH_40.id]);
    }
  });

  it("pairs nothing from a click in another county, and says the click is why", () => {
    const far = pairFieldsWithOutlines(MAP, OUTLINES, { longitude: -92.9, latitude: 41.6 });
    expect(far.outlinesNearby).toBe(0);
    expect(far.pairings.map((p) => unpaired(p).message)).toEqual([
      "Field 3 on tract 5678 (80.20 acres) wasn't matched to an outline because no field outlines were found within 2 km of where you clicked.",
      "Field 1 on tract 6012 (40.00 acres) wasn't matched to an outline because no field outlines were found within 2 km of where you clicked.",
    ]);
  });
});

describe("matching by acres", () => {
  it("fits an outline within 1% of the printed acres, either way, and nothing further", () => {
    expect(acresFit(80.2, 80.2)).toBe(true);
    expect(acresFit(79.4, 80.2)).toBe(true);
    expect(acresFit(81.0, 80.2)).toBe(true);
    expect(acresFit(40.4, 40)).toBe(true);
    expect(acresFit(39.6, 40)).toBe(true);
    expect(acresFit(40.41, 40)).toBe(false);
    expect(acresFit(39.59, 40)).toBe(false);
    expect(acresFit(79.3, 80.2)).toBe(false);
  });

  it("measures the outline the way the database does", () => {
    const [pairing] = pair(oneTract(line("3", FORTY_ACRES)), [FORTY]).pairings;
    expect(pairing.paired && pairing.outlineAcres).toBe(databaseAcres(FORTY));
  });

  it("pairs a field printed a little off its outline", () => {
    const printed = Math.round(FORTY_ACRES * 1.005 * 100) / 100;
    const [pairing] = pair(oneTract(line("3", printed)), [FORTY, EIGHTY]).pairings;
    expect(pairing.paired && pairing.outline.id).toBe("forty");
  });

  it("leaves a field unpaired when no outline is within 1%, and says so in one sentence", () => {
    const printed = Math.round(FORTY_ACRES * 1.02 * 100) / 100;
    const [pairing] = pair(oneTract(line("3", printed)), [FORTY, EIGHTY]).pairings;
    expect(unpaired(pairing).reason).toBe("no_fit");
    expect(unpaired(pairing).message).toBe(
      `Field 3 on tract 5678 (${printed.toFixed(2)} acres) wasn't matched to an outline because no outline within 2 km of where you clicked measures within 1% of its acres.`,
    );
  });

  it("never guesses between two outlines that both fit", () => {
    const twin = rectangle("twin", -93.4188, 42.085, 402, 402);
    const [pairing] = pair(oneTract(line("3", FORTY_ACRES)), [FORTY, twin, EIGHTY]).pairings;
    expect(unpaired(pairing).reason).toBe("several_fit");
    expect(unpaired(pairing).message).toBe(
      `Field 3 on tract 5678 (${FORTY_ACRES.toFixed(2)} acres) wasn't matched to an outline because 2 outlines near where you clicked measure within 1% of its acres, and GrainClaim won't guess between them.`,
    );
  });

  it("never gives one outline to two fields", () => {
    const { pairings } = pair(oneTract(line("1", FORTY_ACRES), line("2", FORTY_ACRES), line("3", EIGHTY_ACRES)), [FORTY, EIGHTY]);
    expect(pairings.map((p) => (p.paired ? p.outline.id : p.reason))).toEqual(["shared_fit", "shared_fit", "eighty"]);
    expect(unpaired(pairings[0]).message).toBe(
      `Field 1 on tract 5678 (${FORTY_ACRES.toFixed(2)} acres) wasn't matched to an outline because the one outline that fits it also fits field 2 on tract 5678 (${FORTY_ACRES.toFixed(2)} acres), and GrainClaim won't guess which is which.`,
    );
  });

  it("leaves a field unpaired when its only outline also fits a field that fits two", () => {
    // An outline about 1% larger than FORTY. Field 1 is printed between the two and fits both; field 2 is
    // printed a little under FORTY and fits only it.
    const larger = rectangle("larger", -93.4188, 42.085, 406, 402);
    const [between, under] = [FORTY_ACRES + 0.2, FORTY_ACRES - 0.18];
    expect([acresFit(FORTY_ACRES, between), acresFit(databaseAcres(larger), between)]).toEqual([true, true]);
    expect([acresFit(FORTY_ACRES, under), acresFit(databaseAcres(larger), under)]).toEqual([true, false]);
    const { pairings } = pair(oneTract(line("1", between), line("2", under)), [FORTY, larger]);
    expect(pairings.map((p) => (p.paired ? p.outline.id : p.reason))).toEqual(["several_fit", "shared_fit"]);
  });
});

describe("only outlines near the click", () => {
  it("is zero meters from an outline the click is inside, and the gap to one it is outside", () => {
    expect(metersFromOutline({ longitude: -93.418, latitude: 42.091 }, FORTY)).toBe(0);
    // FORTY's west edge is 0.0012 degrees east of HERE: about 99 m.
    expect(metersFromOutline(HERE, FORTY)).toBeGreaterThan(95);
    expect(metersFromOutline(HERE, FORTY)).toBeLessThan(103);
  });

  it("looks at an outline whose near edge is within 2 km, though its middle is farther", () => {
    // 1,950 m east of HERE and 400 m wide.
    const edge = rectangle("edge", HERE.longitude + 1950 / 82_600, 42.09, 402, 402);
    expect(metersFromOutline(HERE, edge)).toBeLessThan(NEARBY_METERS);
    const result = pair(oneTract(line("3", databaseAcres(edge))), [edge]);
    expect(result.outlinesNearby).toBe(1);
    expect(result.pairings[0].paired).toBe(true);
  });

  it("doesn't look at an outline more than 2 km away, even one that fits exactly", () => {
    const far = rectangle("far", HERE.longitude + 2100 / 82_600, 42.09, 402, 402);
    expect(metersFromOutline(HERE, far)).toBeGreaterThan(NEARBY_METERS);
    const result = pair(oneTract(line("3", databaseAcres(far)), line("4", EIGHTY_ACRES)), [far, EIGHTY]);
    expect(result.outlinesNearby).toBe(1);
    expect(result.pairings.map((p) => (p.paired ? p.outline.id : p.reason))).toEqual(["no_fit", "eighty"]);
  });

  it("isn't confused by a far twin of a near outline", () => {
    const farTwin = rectangle("far-twin", HERE.longitude + 3000 / 82_600, 42.09, 402, 402);
    const [pairing] = pair(oneTract(line("3", FORTY_ACRES)), [FORTY, farTwin]).pairings;
    expect(pairing.paired && pairing.outline.id).toBe("forty");
  });
});

describe("only cropland fields that were read", () => {
  it("leaves out a field the map draws as something other than cropland, and counts it", () => {
    const result = pair(oneTract(line("3", EIGHTY_ACRES), line("4", FORTY_ACRES, { land_use: "non_cropland" })), [FORTY, EIGHTY]);
    expect(result.pairings.map((p) => p.field)).toEqual(["3"]);
    expect(result.notCropland).toBe(1);
  });

  it("doesn't pair a field when the photo doesn't show whether it is cropland", () => {
    const [pairing] = pair(oneTract(line("3", FORTY_ACRES, { land_use: null })), [FORTY]).pairings;
    expect(unpaired(pairing).reason).toBe("land_use_not_read");
    expect(unpaired(pairing).message).toBe(
      `Field 3 on tract 5678 (${FORTY_ACRES.toFixed(2)} acres) wasn't matched to an outline because the photo doesn't show whether it is cropland.`,
    );
  });

  it("doesn't pair a field whose numbers or acres weren't read, and names what is missing", () => {
    const noNumber = pair(oneTract(line(null, FORTY_ACRES)), [FORTY]).pairings[0];
    expect(unpaired(noNumber).reason).toBe("not_read");
    expect(unpaired(noNumber).message).toBe(
      `A field on tract 5678 (${FORTY_ACRES.toFixed(2)} acres) wasn't matched to an outline because its field number couldn't be read from the photo.`,
    );

    const noAcres = pair(oneTract(line("3", null)), [FORTY]).pairings[0];
    expect(unpaired(noAcres).message).toBe(
      "Field 3 on tract 5678 wasn't matched to an outline because its acres couldn't be read from the photo.",
    );

    const noFarmOrTract = pair({ farm_number: null, tracts: [{ tract: null, fields: [line("3", FORTY_ACRES)] }] }, [FORTY]).pairings[0];
    expect(unpaired(noFarmOrTract).message).toBe(
      `Field 3 (${FORTY_ACRES.toFixed(2)} acres) wasn't matched to an outline because its farm number and tract number couldn't be read from the photo.`,
    );
  });

  it("doesn't pair a field number the map shows twice in one tract", () => {
    const { pairings } = pair(oneTract(line("3", FORTY_ACRES), line("3", EIGHTY_ACRES)), [FORTY, EIGHTY]);
    expect(pairings.map((p) => unpaired(p).reason)).toEqual(["repeated", "repeated"]);
    expect(unpaired(pairings[0]).message).toContain("because the map shows that field number more than once.");
  });

  it("pairs the same field number in two tracts, which are two fields", () => {
    const map: PairingMap = {
      farm_number: "1234",
      tracts: [
        { tract: "5678", fields: [line("1", EIGHTY_ACRES)] },
        { tract: "6012", fields: [line("1", FORTY_ACRES)] },
      ],
    };
    expect(pair(map, [FORTY, EIGHTY]).pairings.map((p) => p.paired && [p.tract, p.outline.id])).toEqual([
      ["5678", "eighty"],
      ["6012", "forty"],
    ]);
  });

  it("keeps a field's printed acres and erodibility with its pair", () => {
    const [pairing] = pair(oneTract(line("3", FORTY_ACRES, { hel: "HEL" })), [FORTY]).pairings;
    expect(pairing).toMatchObject({ paired: true, farm: "1234", tract: "5678", field: "3", acres: FORTY_ACRES, hel: "HEL" });
  });

  it("pairs nothing from a map with no fields", () => {
    expect(pair({ farm_number: "1234", tracts: [] }, [FORTY])).toEqual({ pairings: [], outlinesNearby: 1, notCropland: 0 });
  });
});

describe("fieldWords", () => {
  it("names a field by its number, tract and acres, with whatever was read", () => {
    expect(fieldWords({ tract: "5678", field: "3", acres: 80.2 })).toBe("Field 3 on tract 5678 (80.20 acres)");
    expect(fieldWords({ tract: null, field: null, acres: null })).toBe("A field");
  });
});
