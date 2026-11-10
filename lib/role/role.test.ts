import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE, ROLES, ROLE_LABELS, isRole, parseRole } from "./role";

describe("roles", () => {
  it("has exactly the farmer and the agent, and no driver", () => {
    expect(ROLES).toEqual(["farmer", "agent"]);
  });

  it("has a label for every role", () => {
    expect(ROLE_LABELS).toEqual({ farmer: "Farmer", agent: "Agent" });
  });

  it("opens on the farmer", () => {
    expect(DEFAULT_ROLE).toBe("farmer");
  });
});

describe("isRole", () => {
  it("accepts the two roles", () => {
    expect(isRole("farmer")).toBe(true);
    expect(isRole("agent")).toBe(true);
  });

  it.each([["driver"], ["Farmer"], ["agent "], [""], [null], [undefined], [1], [["agent"]]])(
    "rejects %j",
    (value) => {
      expect(isRole(value)).toBe(false);
    },
  );
});

describe("parseRole", () => {
  it("returns a saved role unchanged", () => {
    expect(parseRole("farmer")).toBe("farmer");
    expect(parseRole("agent")).toBe("agent");
  });

  it("treats a missing cookie as the farmer", () => {
    expect(parseRole(undefined)).toBe("farmer");
  });

  it.each([["driver"], ["AGENT"], [""], [null], [42]])(
    "treats the unrecognised value %j as the farmer",
    (value) => {
      expect(parseRole(value)).toBe("farmer");
    },
  );
});
