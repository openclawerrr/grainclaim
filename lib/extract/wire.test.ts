import { describe, expect, it } from "vitest";
import { percentToFraction, shareAsFraction, stateCode, textOrNull } from "./wire";

describe("turning Claude's answer into the app's values", () => {
  it('turns "" into null and trims text', () => {
    expect(textOrNull("")).toBeNull();
    expect(textOrNull("   ")).toBeNull();
    expect(textOrNull(" 1234 ")).toBe("1234");
  });

  it("turns a percent as printed into a fraction", () => {
    expect(percentToFraction(75)).toBe(0.75);
    expect(percentToFraction(100)).toBe(1);
    expect(percentToFraction(66.67)).toBe(0.6667);
    expect(percentToFraction(null)).toBeNull();
  });

  it("takes a share printed as a fraction or as a percent", () => {
    expect(shareAsFraction(0.6667)).toBe(0.6667);
    expect(shareAsFraction(1)).toBe(1);
    expect(shareAsFraction(66.67)).toBe(0.6667);
    expect(shareAsFraction(100)).toBe(1);
    expect(shareAsFraction(null)).toBeNull();
  });

  it("turns a state's name or code into its two-letter code, and anything else into null", () => {
    expect(stateCode("Iowa")).toBe("IA");
    expect(stateCode("iowa ")).toBe("IA");
    expect(stateCode("ia")).toBe("IA");
    expect(stateCode("New Mexico")).toBe("NM");
    expect(stateCode("NORTH  DAKOTA")).toBe("ND");
    expect(stateCode("District of Columbia")).toBe("DC");
    expect(stateCode("")).toBeNull();
    expect(stateCode("Story County")).toBeNull();
    expect(stateCode("XX")).toBeNull();
    expect(stateCode("constructor")).toBeNull();
  });
});
