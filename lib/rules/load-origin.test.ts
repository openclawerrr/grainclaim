import { describe, expect, it } from "vitest";
import { RuleInputError } from "./errors";
import { originOfLoad } from "./load-origin";

const fields = [
  { id: "field-south", name: "South 40" },
  { id: "field-north", name: "North 80" },
];
const ticket = { buyer_name: "Main Street Elevator", ticket_date: "2026-10-12", ticket_time: "10:42" };

describe("originOfLoad (thin slice)", () => {
  it("says every load came from North 80", () => {
    expect(originOfLoad({ ticket, fields })).toEqual({ kind: "field", fieldId: "field-north" });
  });

  it("doesn't use the ticket's values yet", () => {
    const blank = { buyer_name: null, ticket_date: null, ticket_time: null };
    expect(originOfLoad({ ticket: blank, fields })).toEqual({ kind: "field", fieldId: "field-north" });
  });

  it("refuses to guess when North 80 isn't on the farm map", () => {
    expect(() => originOfLoad({ ticket, fields: [fields[0]] })).toThrow(RuleInputError);
    expect(() => originOfLoad({ ticket, fields: [] })).toThrow("North 80 isn't on the farm map yet");
  });
});
