import { describe, expect, it } from "vitest";
import { RuleInputError } from "./errors";
import {
  guaranteeBushels,
  insuredShareOfProduction,
  shortfallBushels,
  unitPlantedAcres,
  unitProduction,
  unitYield,
} from "./unit";

// SAMPLE: Dave's Farm, 2026 corn, RP 75%, approved yield 180.
const UNIT_1 = { approvedYield: 180, coverageLevel: 0.75, acres: 80.2, share: 1 };
const UNIT_2 = { approvedYield: 180, coverageLevel: 0.75, acres: 40, share: 2 / 3 };

describe("unitProduction", () => {
  it("adds sold, farm-stored, fed and appraised bushels", () => {
    expect(
      unitProduction({
        soldOrCommerciallyStoredBu: 5_800,
        farmStoredMeasuredBu: 2_950,
        fedBu: 100,
        appraisedBu: 50,
      }),
    ).toBe(8_900);
  });

  it("treats fed and appraised as 0 when not given", () => {
    expect(
      unitProduction({ soldOrCommerciallyStoredBu: 5_800, farmStoredMeasuredBu: 2_950 }),
    ).toBe(8_750);
  });

  it("rejects negative bushels", () => {
    expect(() =>
      unitProduction({ soldOrCommerciallyStoredBu: -1, farmStoredMeasuredBu: 0 }),
    ).toThrow(RuleInputError);
    expect(() =>
      unitProduction({ soldOrCommerciallyStoredBu: 0, farmStoredMeasuredBu: 0, appraisedBu: -1 }),
    ).toThrow("Appraised bushels cannot be negative, got -1.");
  });
});

describe("unitYield", () => {
  it("Unit 2: uses 100% of production, 6,000 bu on 40 acres → 150 bu/acre", () => {
    expect(unitYield(6_000, 40)).toBe(150);
  });

  it("rejects zero planted acres", () => {
    expect(() => unitYield(6_000, 0)).toThrow(
      "Planted acres must be greater than zero, got 0.",
    );
  });

  it("rejects negative production", () => {
    expect(() => unitYield(-1, 40)).toThrow(RuleInputError);
  });
});

describe("guaranteeBushels", () => {
  it("Unit 1: 180 × 75% × 80.20 acres × 100% share = 10,827 bu", () => {
    expect(guaranteeBushels(UNIT_1)).toBeCloseTo(10_827, 9);
  });

  it("Unit 2: 180 × 75% × 40 acres × 2/3 share = 3,600 bu", () => {
    expect(guaranteeBushels(UNIT_2)).toBeCloseTo(3_600, 9);
  });

  it("rejects a coverage level written as a percentage", () => {
    expect(() => guaranteeBushels({ ...UNIT_1, coverageLevel: 75 })).toThrow(
      /Coverage level must be a fraction from 0 to 1 \(0\.75 for 75%\), got 75/,
    );
  });

  it("rejects a zero coverage level", () => {
    expect(() => guaranteeBushels({ ...UNIT_1, coverageLevel: 0 })).toThrow(
      "Coverage level must be greater than zero, got 0.",
    );
  });

  it("rejects a share over 100% and negative values", () => {
    expect(() => guaranteeBushels({ ...UNIT_1, share: 1.5 })).toThrow(RuleInputError);
    expect(() => guaranteeBushels({ ...UNIT_1, acres: -80.2 })).toThrow(RuleInputError);
    expect(() => guaranteeBushels({ ...UNIT_1, approvedYield: -180 })).toThrow(RuleInputError);
  });
});

describe("unitPlantedAcres", () => {
  const fieldSeasons = [
    { unit_id: "unit-1", crop_year: 2026, planted_acres: 80.2 },
    { unit_id: "unit-1", crop_year: 2026, planted_acres: 39.8 },
    { unit_id: "unit-2", crop_year: 2026, planted_acres: 40 },
    { unit_id: "unit-1", crop_year: 2025, planted_acres: 77 },
  ];

  it("adds up the unit's fields for one crop year", () => {
    expect(unitPlantedAcres(fieldSeasons, "unit-1", 2026)).toBeCloseTo(120, 9);
    expect(unitPlantedAcres(fieldSeasons, "unit-2", 2026)).toBe(40);
    expect(unitPlantedAcres(fieldSeasons, "unit-1", 2025)).toBe(77);
  });

  it("is zero for a unit with no fields that year", () => {
    expect(unitPlantedAcres(fieldSeasons, "unit-3", 2026)).toBe(0);
    expect(unitPlantedAcres([], "unit-1", 2026)).toBe(0);
  });

  it("rejects planted acres that aren't a number", () => {
    expect(() => unitPlantedAcres([{ unit_id: "unit-1", crop_year: 2026, planted_acres: Number.NaN }], "unit-1", 2026)).toThrow(
      RuleInputError,
    );
  });
});

describe("insuredShareOfProduction", () => {
  it("6,000 bu × 2/3 = 4,000 bu", () => {
    expect(insuredShareOfProduction(6_000, 2 / 3)).toBeCloseTo(4_000, 9);
  });

  it("rejects a share over 100% and negative production", () => {
    expect(() => insuredShareOfProduction(6_000, 2)).toThrow(RuleInputError);
    expect(() => insuredShareOfProduction(-1, 1)).toThrow(RuleInputError);
  });
});

describe("shortfallBushels", () => {
  it("Unit 1: 10,827 − 8,500 = 2,327 bu", () => {
    const guarantee = guaranteeBushels(UNIT_1);
    const production = insuredShareOfProduction(8_500, UNIT_1.share);
    expect(shortfallBushels(guarantee, production)).toBeCloseTo(2_327, 9);
  });

  it("Unit 2: 3,600 − 4,000 → 0, never below zero", () => {
    const guarantee = guaranteeBushels(UNIT_2);
    const production = insuredShareOfProduction(6_000, UNIT_2.share);
    expect(shortfallBushels(guarantee, production)).toBe(0);
  });

  it("rejects negative values", () => {
    expect(() => shortfallBushels(-1, 0)).toThrow(RuleInputError);
    expect(() => shortfallBushels(3_600, -1)).toThrow(RuleInputError);
  });
});
