import { describe, expect, it } from "vitest";
import farm from "../../sample-data/farm.json";
import { BIN_CAPACITY_FACTOR, binCapacityBushels, binSizeProblem, MAX_BIN_FEET, nextBinName, sameBinName } from "./bin-capacity";
import { RuleInputError } from "./errors";

describe("binCapacityBushels", () => {
  it("gives Bin 3 (36 ft across, 24 ft to the eave) 19,633 bushels and Bin 4 (30 by 20) 11,362", () => {
    expect(binCapacityBushels(36, 24)).toBe(19_633);
    expect(binCapacityBushels(30, 20)).toBe(11_362);
  });

  it("gives every sample bin the capacity the database is checked against when the seed loads it", () => {
    expect(farm.bins.length).toBeGreaterThan(0);
    for (const bin of farm.bins) {
      expect(binCapacityBushels(bin.diameter_ft, bin.eave_height_ft), bin.name).toBe(bin.expected_capacity_bu);
    }
  });

  it("is 0.6312 × diameter² × eave height, rounded to a whole bushel", () => {
    expect(BIN_CAPACITY_FACTOR).toBe(0.6312);
    expect(binCapacityBushels(48, 32)).toBe(Math.round(0.6312 * 48 * 48 * 32));
    expect(binCapacityBushels(18.5, 16.25)).toBe(3_510); // 3,510.46
    expect(binCapacityBushels(1, 1)).toBe(1); // 0.6312
  });

  it("rounds a half bushel up, as the database's round() does", () => {
    // 0.6312 × 25² × 5 = 1,972.5 exactly.
    expect(binCapacityBushels(25, 5)).toBe(1_973);
    // 0.6312 × 2.5² × 100 = 394.5 exactly, where plain floating point gives 394.49999999999994.
    expect(0.6312 * 2.5 * 2.5 * 100).toBeLessThan(394.5);
    expect(binCapacityBushels(2.5, 100)).toBe(395);
  });

  it("refuses a size that isn't a positive number of feet to two decimals", () => {
    expect(() => binCapacityBushels(0, 24)).toThrow(RuleInputError);
    expect(() => binCapacityBushels(36, -24)).toThrow("Eave height must be greater than zero");
    expect(() => binCapacityBushels(Number.NaN, 24)).toThrow("Diameter must be a number");
    expect(() => binCapacityBushels(36.125, 24)).toThrow("Diameter can have at most two decimals");
  });
});

describe("binSizeProblem", () => {
  it("takes a believable size", () => {
    for (const feet of [6, 36, 36.5, 24.25, MAX_BIN_FEET]) {
      expect(binSizeProblem("diameter", feet)).toBeNull();
      expect(binSizeProblem("eave_height", feet)).toBeNull();
    }
  });

  it("asks for a size that is missing: there is no default", () => {
    expect(binSizeProblem("diameter", null)).toBe("Enter the diameter in feet.");
    expect(binSizeProblem("eave_height", null)).toBe("Enter the eave height in feet.");
    expect(binSizeProblem("eave_height", Number.NaN)).toBe("Enter the eave height in feet.");
  });

  it("says what is wrong with a size that can't be right", () => {
    expect(binSizeProblem("diameter", 0)).toBe("The diameter has to be more than 0 feet.");
    expect(binSizeProblem("eave_height", -3)).toBe("The eave height has to be more than 0 feet.");
    expect(binSizeProblem("diameter", 3600)).toBe("3,600 feet is too large for a bin's diameter. Check the number.");
    expect(binSizeProblem("eave_height", 24.125)).toBe("Enter the eave height with at most two decimals, such as 36.5.");
  });
});

describe("bin names", () => {
  it("offers the number after the highest numbered bin", () => {
    expect(nextBinName([])).toBe("Bin 1");
    expect(nextBinName(["Bin 1"])).toBe("Bin 2");
    expect(nextBinName(["Bin 1", "Bin 2", "Bin 3"])).toBe("Bin 4");
    // The demo farm has Bin 4 when Bin 3 is added; the farmer types "Bin 3" over the offer.
    expect(nextBinName(["Bin 4"])).toBe("Bin 5");
    expect(nextBinName(["bin  12", "Bin 3"])).toBe("Bin 13");
  });

  it("leaves names that aren't numbered bins out of the count", () => {
    expect(nextBinName(["West bin", "Bin 2A", "Big Bin 9", "Dryer"])).toBe("Bin 1");
    expect(nextBinName(["West bin", "Bin 2"])).toBe("Bin 3");
  });

  it("treats names that differ only in case or spacing as the same bin", () => {
    expect(sameBinName("Bin 3", "bin  3 ")).toBe(true);
    expect(sameBinName("Bin 3", "Bin 30")).toBe(false);
    expect(sameBinName("West bin", "West Bin")).toBe(true);
  });
});
