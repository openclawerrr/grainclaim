import { describe, expect, it } from "vitest";
import {
  aDocumentOfKind,
  addedBeforeMessage,
  DOCUMENT_KIND_NAMES,
  documentKindTitle,
  SEEN_KINDS,
  wrongKindMessage,
} from "./document-kind";

describe("the kinds a document can be named as", () => {
  it("are the four GrainClaim reads, a settlement, and other", () => {
    expect(SEEN_KINDS).toEqual(["fsa_578", "summary_of_coverage", "fsa_map", "scale_ticket", "settlement", "other"]);
    expect(DOCUMENT_KIND_NAMES).not.toContain("other");
  });

  it("each has a title and an article", () => {
    expect(DOCUMENT_KIND_NAMES.map(documentKindTitle)).toEqual(["FSA-578", "Summary of Coverage", "FSA map", "scale ticket", "settlement"]);
    expect(DOCUMENT_KIND_NAMES.map(aDocumentOfKind)).toEqual([
      "an FSA-578",
      "a Summary of Coverage",
      "an FSA map",
      "a scale ticket",
      "a settlement",
    ]);
    expect(documentKindTitle("lease")).toBeNull();
    expect(documentKindTitle("toString")).toBeNull();
  });
});

describe("wrongKindMessage", () => {
  it("says what the file looks like, what was wanted, and what to do", () => {
    expect(wrongKindMessage("fsa_578", "fsa_map")).toBe("This looks like an FSA map, not an FSA-578. Choose your FSA-578.");
    expect(wrongKindMessage("summary_of_coverage", "fsa_578")).toBe(
      "This looks like an FSA-578, not a Summary of Coverage. Choose your Summary of Coverage.",
    );
    expect(wrongKindMessage("fsa_map", "scale_ticket")).toBe(
      "This looks like a scale ticket, not an FSA map. Choose a photo of your FSA map.",
    );
    expect(wrongKindMessage("scale_ticket", "settlement")).toBe(
      "This looks like a settlement, not a scale ticket. Choose a photo of the ticket.",
    );
  });

  it("doesn't guess a name for a file that is none of the kinds", () => {
    expect(wrongKindMessage("fsa_578", "other")).toBe("This doesn't look like an FSA-578. Choose your FSA-578.");
    expect(wrongKindMessage("scale_ticket", "other")).toBe("This doesn't look like a scale ticket. Choose a photo of the ticket.");
  });

  it("is one message for every pair of kinds", () => {
    for (const expected of DOCUMENT_KIND_NAMES) {
      for (const seen of SEEN_KINDS) {
        if (seen === expected) continue;
        const message = wrongKindMessage(expected, seen);
        expect(message, `${seen} as ${expected}`).toMatch(/^This (looks like|doesn't look like) an? .+\. Choose .+\.$/);
        expect(message).not.toContain("undefined");
      }
    }
  });
});

describe("addedBeforeMessage", () => {
  it("names the kind the file was saved as", () => {
    expect(addedBeforeMessage("fsa_578", "fsa_map")).toBe("This file was added before as your FSA map. Choose your FSA-578.");
    expect(addedBeforeMessage("fsa_map", "summary_of_coverage")).toBe(
      "This file was added before as your Summary of Coverage. Choose a photo of your FSA map.",
    );
  });

  it("doesn't name a kind it has no word for", () => {
    expect(addedBeforeMessage("fsa_578", "lease")).toBe("This file was added before as another document. Choose your FSA-578.");
  });
});
