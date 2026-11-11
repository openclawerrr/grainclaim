import { describe, expect, it } from "vitest";
import farm from "../../sample-data/farm.json";
import { binCapacityBushels } from "../rules/bin-capacity";
import { addBin, ewktPoint, typedNumber, type BinStore, type NewBinInput, type NewBinRow } from "./add-bin";

const BIN_3 = farm.bins.find((bin) => bin.name === "Bin 3")!;
/** What Dave gives in the demo: a click beside his farmstead, the name, 36 ft across and 24 ft to the eave. */
const INPUT: NewBinInput = {
  name: "Bin 3",
  diameterFt: "36",
  eaveHeightFt: "24",
  longitude: String(BIN_3.location[0]),
  latitude: String(BIN_3.location[1]),
};
const withInput = (changes: Partial<NewBinInput>): NewBinInput => ({ ...INPUT, ...changes });

/** A stand-in for the database: the farm has Bin 4, and saving works out the capacity as the database does. */
function fakeStore(binNames: string[] | null = ["Bin 4"]) {
  const inserted: NewBinRow[] = [];
  let farmLoads = 0;
  const store: BinStore = {
    async loadFarm() {
      farmLoads += 1;
      return binNames === null ? null : { insuredId: "insured-1", binNames };
    },
    async insertBin(row) {
      inserted.push(row);
      const [longitude, latitude] = /POINT\((\S+) (\S+)\)/.exec(row.location)!.slice(1).map(Number);
      return {
        id: `bin-${inserted.length}`,
        name: row.name,
        longitude,
        latitude,
        diameterFt: row.diameter_ft,
        eaveHeightFt: row.eave_height_ft,
        capacityBu: binCapacityBushels(row.diameter_ft, row.eave_height_ft),
      };
    },
  };
  return { store, inserted, farmLoads: () => farmLoads };
}

describe("addBin", () => {
  it("saves Bin 3 at the clicked spot with its size, and returns the capacity the database calculated", async () => {
    const { store, inserted } = fakeStore();
    const outcome = await addBin(INPUT, "farmer", { store });

    expect(inserted).toEqual([
      {
        insured_id: "insured-1",
        name: "Bin 3",
        location: "SRID=4326;POINT(-93.43004 42.09322)",
        diameter_ft: 36,
        eave_height_ft: 24,
      },
    ]);
    expect(outcome).toEqual({
      status: "saved",
      bin: { id: "bin-1", name: "Bin 3", longitude: -93.43004, latitude: 42.09322, diameterFt: 36, eaveHeightFt: 24, capacityBu: 19_633 },
    });
    expect(BIN_3.expected_capacity_bu).toBe(19_633);
  });

  it("never sends a capacity: the database works it out", async () => {
    const { store, inserted } = fakeStore();
    await addBin(INPUT, "farmer", { store });
    expect(Object.keys(inserted[0]).sort()).toEqual(["diameter_ft", "eave_height_ft", "insured_id", "location", "name"]);
  });

  it("requires both sizes: neither has a default", async () => {
    const { store, inserted, farmLoads } = fakeStore();
    expect(await addBin(withInput({ diameterFt: "" }), "farmer", { store })).toEqual({
      status: "not_saved",
      message: "Enter the diameter in feet.",
      field: "diameter",
    });
    expect(await addBin(withInput({ eaveHeightFt: "  " }), "farmer", { store })).toEqual({
      status: "not_saved",
      message: "Enter the eave height in feet.",
      field: "eave_height",
    });
    expect(await addBin(withInput({ diameterFt: "", eaveHeightFt: "" }), "farmer", { store })).toMatchObject({ field: "diameter" });
    expect(inserted).toEqual([]);
    // Nothing is asked of the database until the form is right.
    expect(farmLoads()).toBe(0);
  });

  it("says what is wrong with a size that can't be right, and saves nothing", async () => {
    const { store, inserted } = fakeStore();
    const message = async (changes: Partial<NewBinInput>) => {
      const outcome = await addBin(withInput(changes), "farmer", { store });
      return outcome.status === "not_saved" ? outcome.message : "saved";
    };
    expect(await message({ diameterFt: "0" })).toBe("The diameter has to be more than 0 feet.");
    expect(await message({ diameterFt: "36 ft" })).toBe("Enter the diameter in feet.");
    expect(await message({ diameterFt: "3600" })).toBe("3,600 feet is too large for a bin's diameter. Check the number.");
    expect(await message({ eaveHeightFt: "-24" })).toBe("The eave height has to be more than 0 feet.");
    expect(await message({ eaveHeightFt: "24.125" })).toBe("Enter the eave height with at most two decimals, such as 36.5.");
    expect(inserted).toEqual([]);
  });

  it("takes sizes with decimals", async () => {
    const { store, inserted } = fakeStore();
    const outcome = await addBin(withInput({ diameterFt: " 36.5 ", eaveHeightFt: "24.25" }), "farmer", { store });
    expect(outcome.status).toBe("saved");
    expect(inserted[0]).toMatchObject({ diameter_ft: 36.5, eave_height_ft: 24.25 });
  });

  it("needs a spot on the map", async () => {
    const { store, inserted } = fakeStore();
    for (const changes of [{ longitude: "" }, { latitude: "" }, { longitude: "-193.4" }, { latitude: "142" }, { longitude: "west" }]) {
      expect(await addBin(withInput(changes), "farmer", { store })).toEqual({
        status: "not_saved",
        message: "Click the spot on the map where the bin stands.",
        field: "location",
      });
    }
    expect(inserted).toEqual([]);
  });

  it("stores the spot to six decimals, about 11 cm", async () => {
    const { store, inserted } = fakeStore();
    await addBin(withInput({ longitude: "-93.43003987654321", latitude: "42.093221234567" }), "farmer", { store });
    expect(inserted[0].location).toBe("SRID=4326;POINT(-93.43004 42.093221)");
  });

  it("needs a name, takes any name, and tidies its spaces", async () => {
    const { store, inserted } = fakeStore();
    expect(await addBin(withInput({ name: "   " }), "farmer", { store })).toEqual({
      status: "not_saved",
      message: "Give the bin a name, such as Bin 3.",
      field: "name",
    });
    expect(await addBin(withInput({ name: "x".repeat(41) }), "farmer", { store })).toMatchObject({
      message: "That name is too long. Keep it to 40 letters or fewer.",
      field: "name",
    });
    expect((await addBin(withInput({ name: "  West   bin " }), "farmer", { store })).status).toBe("saved");
    expect(inserted.map((row) => row.name)).toEqual(["West bin"]);
  });

  it("refuses a name the farm already uses, whatever its case or spacing", async () => {
    const { store, inserted } = fakeStore(["Bin 3", "Bin 4"]);
    expect(await addBin(withInput({ name: "bin  3" }), "farmer", { store })).toEqual({
      status: "not_saved",
      message: "You already have a Bin 3. Give this bin a different name.",
      field: "name",
    });
    expect(inserted).toEqual([]);
  });

  it("is the farmer's job: the agent can't add a bin", async () => {
    const { store, inserted, farmLoads } = fakeStore();
    expect(await addBin(INPUT, "agent", { store })).toEqual({
      status: "not_saved",
      message: "Only the farmer adds bins. Switch to Farmer to add one.",
      field: undefined,
    });
    expect(inserted).toEqual([]);
    expect(farmLoads()).toBe(0);
  });

  it("says so when no farm is set up", async () => {
    const { store, inserted } = fakeStore(null);
    expect(await addBin(INPUT, "farmer", { store })).toMatchObject({
      status: "not_saved",
      message: "Your farm isn't set up yet, so there is nowhere to add a bin.",
    });
    expect(inserted).toEqual([]);
  });

  it("passes on a failure from the database", async () => {
    const store: BinStore = {
      loadFarm: async () => ({ insuredId: "insured-1", binNames: [] }),
      insertBin: async () => {
        throw new Error("Saving the bin failed: connection lost");
      },
    };
    await expect(addBin(INPUT, "farmer", { store })).rejects.toThrow("Saving the bin failed: connection lost");
  });
});

describe("typedNumber", () => {
  it("reads a number as typed, and nothing else", () => {
    expect(["36", " 36.5 ", "36.", ".5", "0", "-3"].map(typedNumber)).toEqual([36, 36.5, 36, 0.5, 0, -3]);
    expect(["", " ", "36 ft", "36,5", "1e3", "thirty", "Infinity", "0x24"].map(typedNumber)).toEqual(Array(8).fill(null));
  });
});

describe("ewktPoint", () => {
  it("writes longitude first, as PostGIS reads it", () => {
    expect(ewktPoint(-93.43004, 42.09322)).toBe("SRID=4326;POINT(-93.43004 42.09322)");
  });
});
