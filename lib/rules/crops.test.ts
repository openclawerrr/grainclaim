import { describe, expect, it } from "vitest";
import { assertCrop, CROPS, STANDARD_WEIGHT_LB } from "./crops";
import { RuleInputError } from "./errors";

describe("STANDARD_WEIGHT_LB", () => {
  it("matches spec Part 3", () => {
    expect(STANDARD_WEIGHT_LB).toEqual({ corn: 56, soybeans: 60, wheat: 60 });
  });

  it("has a weight for every crop", () => {
    for (const crop of CROPS) {
      expect(STANDARD_WEIGHT_LB[crop]).toBeGreaterThan(0);
    }
  });
});

describe("assertCrop", () => {
  it("accepts every known crop", () => {
    for (const crop of CROPS) {
      expect(() => assertCrop(crop)).not.toThrow();
    }
  });

  it("rejects an unknown crop with a clear message", () => {
    expect(() => assertCrop("barley")).toThrow(RuleInputError);
    expect(() => assertCrop("barley")).toThrow(
      'Unknown crop "barley". Expected one of: corn, soybeans, wheat.',
    );
  });

  it("does not guess at ticket wording or capitals", () => {
    expect(() => assertCrop("Corn")).toThrow(RuleInputError);
    expect(() => assertCrop("YELLOW CORN #2")).toThrow(RuleInputError);
  });

  it("rejects empty and non-string values", () => {
    expect(() => assertCrop("")).toThrow(RuleInputError);
    expect(() => assertCrop(undefined)).toThrow(RuleInputError);
    expect(() => assertCrop(56)).toThrow(RuleInputError);
  });
});
