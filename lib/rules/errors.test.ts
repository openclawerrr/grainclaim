import { describe, expect, it } from "vitest";
import {
  RuleInputError,
  requireFinite,
  requireFraction,
  requireNonNegative,
  requirePercent,
  requirePositive,
} from "./errors";

describe("RuleInputError", () => {
  it("is an Error with its own name", () => {
    const error = new RuleInputError("bad input");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RuleInputError");
    expect(error.message).toBe("bad input");
  });
});

describe("requireFinite", () => {
  it("accepts ordinary numbers", () => {
    expect(() => requireFinite("Value", 0)).not.toThrow();
    expect(() => requireFinite("Value", -3.5)).not.toThrow();
  });

  it("rejects NaN, Infinity and non-numbers", () => {
    expect(() => requireFinite("Value", NaN)).toThrow(RuleInputError);
    expect(() => requireFinite("Value", Infinity)).toThrow(RuleInputError);
    expect(() => requireFinite("Value", "12" as unknown as number)).toThrow(
      "Value must be a number, got 12.",
    );
  });
});

describe("requireNonNegative", () => {
  it("accepts zero and positive numbers", () => {
    expect(() => requireNonNegative("Value", 0)).not.toThrow();
    expect(() => requireNonNegative("Value", 1)).not.toThrow();
  });

  it("rejects negative numbers, naming the field", () => {
    expect(() => requireNonNegative("Gross weight (lb)", -5)).toThrow(
      "Gross weight (lb) cannot be negative, got -5.",
    );
  });
});

describe("requirePositive", () => {
  it("rejects zero", () => {
    expect(() => requirePositive("Planted acres", 0)).toThrow(
      "Planted acres must be greater than zero, got 0.",
    );
  });

  it("accepts positive numbers", () => {
    expect(() => requirePositive("Planted acres", 0.1)).not.toThrow();
  });
});

describe("requireFraction", () => {
  it("accepts 0 through 1", () => {
    expect(() => requireFraction("Share", 0)).not.toThrow();
    expect(() => requireFraction("Share", 2 / 3)).not.toThrow();
    expect(() => requireFraction("Share", 1)).not.toThrow();
  });

  it("rejects a percentage passed by mistake", () => {
    expect(() => requireFraction("Coverage level", 75)).toThrow(/0\.75 for 75%/);
  });

  it("rejects negative values", () => {
    expect(() => requireFraction("Share", -0.1)).toThrow(RuleInputError);
  });
});

describe("requirePercent", () => {
  it("accepts 0 through 100", () => {
    expect(() => requirePercent("Moisture", 0)).not.toThrow();
    expect(() => requirePercent("Moisture", 17.5)).not.toThrow();
    expect(() => requirePercent("Moisture", 100)).not.toThrow();
  });

  it("rejects values outside 0 to 100", () => {
    expect(() => requirePercent("Moisture", 101)).toThrow(RuleInputError);
    expect(() => requirePercent("Moisture", -1)).toThrow(RuleInputError);
  });
});
