import { describe, expect, it } from "vitest";
import { binBalance, binEstimateBushels } from "./bin";
import { RuleInputError } from "./errors";

describe("binEstimateBushels", () => {
  it("Bin 3: 36 ft diameter, 10 ft of grain → about 8,165 bu", () => {
    const estimate = binEstimateBushels(36, 10);
    expect(estimate).toBeCloseTo(8_164.8, 9);
    expect(Math.round(estimate)).toBe(8_165);
  });

  it("an empty bin holds 0 bu", () => {
    expect(binEstimateBushels(30, 0)).toBe(0);
  });

  it("rejects a zero or negative diameter", () => {
    expect(() => binEstimateBushels(0, 10)).toThrow(
      "Bin diameter (ft) must be greater than zero, got 0.",
    );
    expect(() => binEstimateBushels(-36, 10)).toThrow(RuleInputError);
  });

  it("rejects negative grain depth", () => {
    expect(() => binEstimateBushels(36, -1)).toThrow(RuleInputError);
  });
});

describe("binBalance", () => {
  it("3,000 in vs 2,950 out plus remaining → no flag", () => {
    const result = binBalance({
      estimatedInBu: 3_000,
      ticketedOutBu: 2_500,
      measuredRemainingBu: 450,
    });
    expect(result.accountedForBu).toBe(2_950);
    expect(result.gapBu).toBe(50);
    expect(result.gapPct).toBeCloseTo(1.667, 3);
    expect(result.flagged).toBe(false);
  });

  it("a gap over 3% → flag", () => {
    const result = binBalance({
      estimatedInBu: 3_000,
      ticketedOutBu: 2_500,
      measuredRemainingBu: 400,
    });
    expect(result.gapBu).toBe(100);
    expect(result.gapPct).toBeCloseTo(3.333, 3);
    expect(result.flagged).toBe(true);
  });

  it("a gap of exactly 3% is not flagged (the rule is over 3%)", () => {
    const result = binBalance({
      estimatedInBu: 3_000,
      ticketedOutBu: 2_910,
      measuredRemainingBu: 0,
    });
    expect(result.gapPct).toBe(3);
    expect(result.flagged).toBe(false);
  });

  it("more out than in by over 3% → flag, with a negative gap", () => {
    const result = binBalance({
      estimatedInBu: 3_000,
      ticketedOutBu: 3_100,
      measuredRemainingBu: 0,
    });
    expect(result.gapBu).toBe(-100);
    expect(result.gapPct).toBeCloseTo(3.333, 3);
    expect(result.flagged).toBe(true);
  });

  it("rejects zero estimated in", () => {
    expect(() =>
      binBalance({ estimatedInBu: 0, ticketedOutBu: 0, measuredRemainingBu: 0 }),
    ).toThrow("Estimated bushels in must be greater than zero, got 0.");
  });

  it("rejects negative bushels out or remaining", () => {
    expect(() =>
      binBalance({ estimatedInBu: 3_000, ticketedOutBu: -1, measuredRemainingBu: 0 }),
    ).toThrow(RuleInputError);
    expect(() =>
      binBalance({ estimatedInBu: 3_000, ticketedOutBu: 0, measuredRemainingBu: -1 }),
    ).toThrow(RuleInputError);
  });
});
