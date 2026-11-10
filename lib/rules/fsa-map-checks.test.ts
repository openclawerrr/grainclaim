import { describe, expect, it } from "vitest";
import { documentsOfKind, loadDocumentsFile } from "../../scripts/print/documents-file";
import { checkFsaMap, fsaMapFieldLabels, fsaMapTractLabels, type FsaMapCheckInput } from "./fsa-map-checks";

// The SAMPLE FSA map as printed in the answer key.
const MAP: FsaMapCheckInput = documentsOfKind(loadDocumentsFile(), "fsa_map")[0][1].values;
const NORTH_TRACT = "tract 1234/5678";
const SOUTH_TRACT = "tract 1234/6012";
const NORTH = "field 1234/5678/3";
const SOUTH = "field 1234/6012/1";

type Tract = FsaMapCheckInput["tracts"][number];
type Field = Tract["fields"][number];
/** The sample map with one tract changed: 0 is tract 5678, 1 is tract 6012. */
const withTract = (index: number, changes: Partial<Tract>): FsaMapCheckInput => ({
  ...MAP,
  tracts: MAP.tracts.map((tract, i) => (i === index ? { ...tract, ...changes } : tract)),
});
/** The sample map with tract 5678's field changed. */
const withNorth = (changes: Partial<Field>) => withTract(0, { fields: [{ ...MAP.tracts[0].fields[0], ...changes }] });
/** The sample map with more fields in tract 5678, after its own field 3. */
const withMoreInNorth = (...more: Field[]) => withTract(0, { fields: [...MAP.tracts[0].fields, ...more] });
const failed = (map: FsaMapCheckInput) => checkFsaMap(map).filter((c) => c.status === "fail");
const check = (map: FsaMapCheckInput, id: string, nth = 0) => checkFsaMap(map).filter((c) => c.id === id)[nth];

describe("naming the rows", () => {
  it("names a tract by its farm and tract number", () => {
    expect(fsaMapTractLabels(MAP)).toEqual([NORTH_TRACT, SOUTH_TRACT]);
    expect(fsaMapTractLabels({ farm_number: null, tracts: [{ ...MAP.tracts[0], tract: null }] })).toEqual(["tract ?/?"]);
  });

  it("names a field by its farm, tract and field number, as the FSA-578 does", () => {
    expect(fsaMapFieldLabels(MAP)).toEqual([[NORTH], [SOUTH]]);
  });

  it("keeps two fields read with the same number apart", () => {
    const twice = withMoreInNorth({ field: "3", acres: 5, land_use: "cropland" });
    expect(fsaMapFieldLabels(twice)).toEqual([[NORTH, `${NORTH} (2nd)`], [SOUTH]]);
  });

  it("keeps each tract's fields with their tract", () => {
    const oneEmpty = { ...MAP, tracts: [{ ...MAP.tracts[0], fields: [] }, MAP.tracts[1]] };
    expect(fsaMapFieldLabels(oneEmpty)).toEqual([[], [SOUTH]]);
  });
});

describe("the sample FSA map", () => {
  it("passes every check", () => {
    const checks = checkFsaMap(MAP);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ["tract_cropland", "pass"],
      ["tract_cropland", "pass"],
      ["field_numbers", "pass"],
      ["field_numbers", "pass"],
    ]);
    expect(checks.map((c) => c.message)).toEqual([
      "Tract 1234/5678's cropland fields add up to its cropland total (80.2 acres).",
      "Tract 1234/6012's cropland fields add up to its cropland total (40 acres).",
      "Tract 1234/5678's field numbers are all different.",
      "Tract 1234/6012's field numbers are all different.",
    ]);
  });

  it("names the values each check uses", () => {
    expect(check(MAP, "tract_cropland").fields).toEqual([`${NORTH}: acres`, `${NORTH}: land_use`, `${NORTH_TRACT}: cropland_acres`]);
    expect(check(MAP, "field_numbers", 1).fields).toEqual([`${SOUTH}: field`]);
  });
});

describe("a tract's cropland total", () => {
  it("catches misread acres and points at that tract's acres, land uses and total", () => {
    // 80.20 read as 60.20.
    const misread = withNorth({ acres: 60.2 });
    expect(failed(misread)).toEqual([
      {
        id: "tract_cropland",
        status: "fail",
        fields: [`${NORTH}: acres`, `${NORTH}: land_use`, `${NORTH_TRACT}: cropland_acres`],
        message: "Tract 1234/5678's cropland total reads 80.2 acres, but its cropland fields add up to 60.2.",
      },
    ]);
  });

  it("catches a misread total", () => {
    expect(failed(withTract(1, { cropland_acres: 48 })).map((c) => c.message)).toEqual([
      "Tract 1234/6012's cropland total reads 48 acres, but its cropland fields add up to 40.",
    ]);
  });

  it("adds up several cropland fields, to the cent", () => {
    const three = withTract(0, {
      cropland_acres: 80.2,
      fields: [
        { field: "1", acres: 31.37, land_use: "cropland" },
        { field: "2", acres: 28.61, land_use: "cropland" },
        { field: "3", acres: 20.22, land_use: "cropland" },
      ],
    });
    expect(check(three, "tract_cropland").status).toBe("pass");
  });

  it("leaves non-cropland fields out of the total", () => {
    const farmstead: Field = { field: "4", acres: 3.1, land_use: "non_cropland" };
    expect(check(withMoreInNorth(farmstead), "tract_cropland").status).toBe("pass");
    // Read as cropland, the same field breaks the total.
    expect(check(withMoreInNorth({ ...farmstead, land_use: "cropland" }), "tract_cropland").message).toBe(
      "Tract 1234/5678's cropland total reads 80.2 acres, but its cropland fields add up to 83.3.",
    );
    // A non-cropland field's acres aren't needed.
    expect(check(withMoreInNorth({ ...farmstead, acres: null }), "tract_cropland").status).toBe("pass");
  });

  it("takes a tract with no cropland and a total of 0", () => {
    const pasture = withTract(1, { cropland_acres: 0, fields: [{ field: "1", acres: 40, land_use: "non_cropland" }] });
    expect(check(pasture, "tract_cropland", 1).status).toBe("pass");
  });

  it("isn't checked without the total, a cropland field's acres, a field's land use, or any field", () => {
    expect(check(withTract(0, { cropland_acres: null }), "tract_cropland")).toMatchObject({
      status: "not_checked",
      message: "Tract 1234/5678's cropland total can't be checked because tract 1234/5678: cropland_acres wasn't read.",
    });
    expect(check(withNorth({ acres: null }), "tract_cropland").message).toBe(
      "Tract 1234/5678's cropland total can't be checked because field 1234/5678/3: acres wasn't read.",
    );
    // A field whose land use wasn't read might count or might not.
    expect(check(withNorth({ land_use: null }), "tract_cropland").message).toBe(
      "Tract 1234/5678's cropland total can't be checked because field 1234/5678/3: land_use wasn't read.",
    );
    expect(check(withNorth({ acres: null, land_use: null }), "tract_cropland").message).toBe(
      "Tract 1234/5678's cropland total can't be checked because field 1234/5678/3: acres and field 1234/5678/3: land_use weren't read.",
    );
    expect(check(withTract(0, { fields: [] }), "tract_cropland")).toMatchObject({
      status: "not_checked",
      fields: [`${NORTH_TRACT}: cropland_acres`],
      message: "Tract 1234/5678's cropland total can't be checked because none of its fields were read.",
    });
    // The other tract is still checked.
    expect(check(withTract(0, { fields: [] }), "tract_cropland", 1).status).toBe("pass");
  });

  it("doesn't take negative acres as a reading", () => {
    expect(check(withNorth({ acres: -80.2 }), "tract_cropland").status).toBe("not_checked");
  });
});

describe("field numbers", () => {
  it("catches a field number that appears twice in a tract and points at both", () => {
    // Field 8 read as 3.
    const twice = withMoreInNorth({ field: "3", acres: 0, land_use: "non_cropland" });
    expect(failed(twice)).toEqual([
      {
        id: "field_numbers",
        status: "fail",
        fields: [`${NORTH}: field`, `${NORTH} (2nd): field`],
        message: "Tract 1234/5678 shows field 3 more than once.",
      },
    ]);
  });

  it("lets two tracts each have a field with the same number", () => {
    const bothField1 = withNorth({ field: "1" });
    expect(checkFsaMap(bothField1).filter((c) => c.id === "field_numbers").map((c) => c.status)).toEqual(["pass", "pass"]);
  });

  it("isn't checked when a field number wasn't read or the tract has no fields", () => {
    expect(check(withNorth({ field: null }), "field_numbers")).toMatchObject({
      status: "not_checked",
      message: "Tract 1234/5678's field numbers can't be checked because field 1234/5678/?: field wasn't read.",
    });
    expect(check(withTract(1, { fields: [] }), "field_numbers", 1).message).toBe(
      "Tract 1234/6012's field numbers can't be checked because none of its fields were read.",
    );
  });
});
