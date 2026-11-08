import { describe, expect, it } from "vitest";
import type { Crop } from "./crops";
import { RuleInputError } from "./errors";
import {
  elevatorDryBushels,
  insuranceMoistureReductionPct,
  insuranceProductionToCount,
  netWeightLb,
  wetBushels,
} from "./ticket";

// Worked example: a SAMPLE corn ticket at 17.5% moisture, sold to a buyer
// with a 15% base and 1.4% shrink per point.
const BUYER = { baseMoisturePct: 15, shrinkPctPerPoint: 1.4 };

describe("worked example: one corn ticket from gross to insurance bushels", () => {
  const net = netWeightLb(80_120, 24_600);
  const wet = wetBushels(net, "corn");

  it("gross 80,120 − tare 24,600 = 55,520 lb net", () => {
    expect(net).toBe(55_520);
  });

  it("55,520 lb ÷ 56 = 991.43 wet bushels", () => {
    expect(wet).toBeCloseTo(991.43, 2);
  });

  it("insurance production to count at 17.5% is 961.69 bu", () => {
    expect(insuranceProductionToCount(wet, "corn", 17.5)).toBeCloseTo(961.69, 2);
  });

  it("elevator dry bushels at 17.5% with 1.4% shrink over 15% is 956.73 bu", () => {
    expect(elevatorDryBushels(wet, 17.5, BUYER)).toBeCloseTo(956.73, 2);
  });

  it("elevator and insurance numbers differ for the same load", () => {
    expect(elevatorDryBushels(wet, 17.5, BUYER)).not.toBeCloseTo(
      insuranceProductionToCount(wet, "corn", 17.5),
      0,
    );
  });

  it("keeps full precision instead of rounding", () => {
    expect(wet).toBe(55_520 / 56);
    expect(wet).not.toBe(991.43);
  });
});

describe("netWeightLb", () => {
  it("allows gross equal to tare (an empty truck)", () => {
    expect(netWeightLb(24_600, 24_600)).toBe(0);
  });

  it("rejects tare above gross", () => {
    expect(() => netWeightLb(24_600, 80_120)).toThrow(RuleInputError);
    expect(() => netWeightLb(24_600, 80_120)).toThrow(
      "Tare (80120 lb) is greater than gross (24600 lb). Check the ticket read.",
    );
  });

  it("rejects negative weights", () => {
    expect(() => netWeightLb(-1, 0)).toThrow(/Gross weight \(lb\) cannot be negative/);
    expect(() => netWeightLb(80_120, -1)).toThrow(/Tare weight \(lb\) cannot be negative/);
  });

  it("rejects a missing read (NaN)", () => {
    expect(() => netWeightLb(NaN, 24_600)).toThrow(RuleInputError);
  });
});

describe("wetBushels", () => {
  it("divides soybeans by 60 lb: 60,000 lb → 1,000 bu", () => {
    expect(wetBushels(60_000, "soybeans")).toBe(1_000);
  });

  it("divides wheat by 60 lb", () => {
    expect(wetBushels(60_000, "wheat")).toBe(1_000);
  });

  it("rejects an unknown crop", () => {
    expect(() => wetBushels(60_000, "barley" as Crop)).toThrow(
      'Unknown crop "barley". Expected one of: corn, soybeans, wheat.',
    );
  });

  it("rejects negative net weight", () => {
    expect(() => wetBushels(-56, "corn")).toThrow(RuleInputError);
  });
});

describe("elevatorDryBushels", () => {
  it("makes no deduction at the buyer's base moisture", () => {
    expect(elevatorDryBushels(1_000, 15, BUYER)).toBe(1_000);
  });

  it("makes no deduction below the buyer's base moisture", () => {
    expect(elevatorDryBushels(1_000, 13.2, BUYER)).toBe(1_000);
  });

  it("works for wheat, which has no insurance moisture rule", () => {
    expect(elevatorDryBushels(1_000, 14.5, { baseMoisturePct: 13.5, shrinkPctPerPoint: 1.3 })).toBeCloseTo(987, 9);
  });

  it("rejects a shrink that would remove more than the whole load", () => {
    expect(() => elevatorDryBushels(1_000, 80, { baseMoisturePct: 15, shrinkPctPerPoint: 2 })).toThrow(
      /more than the whole load/,
    );
  });

  it("rejects negative shrink and impossible moisture", () => {
    expect(() => elevatorDryBushels(1_000, 17.5, { baseMoisturePct: 15, shrinkPctPerPoint: -1.4 })).toThrow(
      RuleInputError,
    );
    expect(() => elevatorDryBushels(1_000, 117.5, BUYER)).toThrow(/Moisture must be a percentage/);
    expect(() => elevatorDryBushels(-1, 17.5, BUYER)).toThrow(RuleInputError);
  });
});

describe("insuranceMoistureReductionPct", () => {
  it("corn: 1.2% per point above 15%", () => {
    expect(insuranceMoistureReductionPct("corn", 17.5)).toBeCloseTo(3, 9);
  });

  it("corn: no reduction at or below 15%", () => {
    expect(insuranceMoistureReductionPct("corn", 15)).toBe(0);
    expect(insuranceMoistureReductionPct("corn", 12)).toBe(0);
  });

  it("corn: exactly 30% is 15 points at 1.2% = 18%", () => {
    expect(insuranceMoistureReductionPct("corn", 30)).toBeCloseTo(18, 9);
  });

  it("corn: 2% applies only to points above 30% (32% → 22%)", () => {
    expect(insuranceMoistureReductionPct("corn", 32)).toBeCloseTo(22, 9);
  });

  it("soybeans: 1.2% per point above 13%", () => {
    expect(insuranceMoistureReductionPct("soybeans", 14)).toBeCloseTo(1.2, 9);
    expect(insuranceMoistureReductionPct("soybeans", 13)).toBe(0);
    expect(insuranceMoistureReductionPct("soybeans", 11)).toBe(0);
  });

  it("wheat: throws because there is no rule yet", () => {
    expect(() => insuranceMoistureReductionPct("wheat", 14)).toThrow(RuleInputError);
    expect(() => insuranceMoistureReductionPct("wheat", 14)).toThrow(
      /No insurance moisture rule for wheat yet/,
    );
  });

  it("rejects an unknown crop and impossible moisture", () => {
    expect(() => insuranceMoistureReductionPct("barley" as Crop, 14)).toThrow(/Unknown crop "barley"/);
    expect(() => insuranceMoistureReductionPct("corn", -1)).toThrow(RuleInputError);
    expect(() => insuranceMoistureReductionPct("corn", 101)).toThrow(RuleInputError);
  });
});

describe("insuranceProductionToCount", () => {
  it("soybeans: 1,000 wet bu at 14% → 988 bu", () => {
    expect(insuranceProductionToCount(1_000, "soybeans", 14)).toBeCloseTo(988, 9);
  });

  it("corn at or below 15%: no deduction", () => {
    expect(insuranceProductionToCount(1_000, "corn", 15)).toBe(1_000);
    expect(insuranceProductionToCount(1_000, "corn", 14)).toBe(1_000);
  });

  it("corn at 32%: 22% reduction", () => {
    expect(insuranceProductionToCount(1_000, "corn", 32)).toBeCloseTo(780, 9);
  });

  it("wheat: throws instead of guessing a rate", () => {
    expect(() => insuranceProductionToCount(1_000, "wheat", 14)).toThrow(
      /No insurance moisture rule for wheat yet/,
    );
  });

  it("rejects moisture that would reduce more than the whole load", () => {
    // Corn at 80%: 18% + 50 × 2% = 118%.
    expect(() => insuranceProductionToCount(1_000, "corn", 80)).toThrow(/more than the whole load/);
  });

  it("rejects negative wet bushels", () => {
    expect(() => insuranceProductionToCount(-1, "corn", 17.5)).toThrow(RuleInputError);
  });
});
