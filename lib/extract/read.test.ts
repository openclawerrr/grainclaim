import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { kindNamedIn, photoBlock, photoOrPdfBlock, readWithClaude, validateAgainst, type ReadRequest } from "./read";
import { answeringClient } from "./wire-schema-testing";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.7 sample");
const TEXT = new TextEncoder().encode("not a document");

describe("the file Claude is sent", () => {
  it("sends a photo as an image of its own type", () => {
    expect(photoBlock(JPEG, "A ticket photo")).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(JPEG).toString("base64") },
    });
    expect(photoBlock(PNG, "A ticket photo").source).toMatchObject({ media_type: "image/png" });
  });

  it("sends a PDF as the document itself", () => {
    expect(photoOrPdfBlock(PDF, "A Summary of Coverage")).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: Buffer.from(PDF).toString("base64") },
    });
    expect(photoOrPdfBlock(JPEG, "A Summary of Coverage").type).toBe("image");
  });

  it("refuses any other kind of file, naming what it should be", () => {
    expect(() => photoBlock(PDF, "A ticket photo")).toThrow("A ticket photo must be a JPEG or PNG file.");
    expect(() => photoOrPdfBlock(TEXT, "An FSA-578")).toThrow("An FSA-578 must be a JPEG or PNG photo, or a PDF.");
  });
});

describe("validateAgainst", () => {
  const schema = z.object({ acres: z.number().nullable() });

  it("returns the values when they fit, and one sentence when they don't", () => {
    expect(validateAgainst(schema, { acres: 80 }, "FSA-578")).toEqual({ ok: true, values: { acres: 80 } });
    expect(validateAgainst(schema, { acres: "80" }, "FSA-578")).toEqual({
      ok: false,
      reason: expect.stringMatching(/^The answer didn't fit the FSA-578 schema \(acres: /),
    });
  });
});

describe("kindNamedIn", () => {
  it("finds the kind an answer names", () => {
    expect(kindNamedIn('{"document_kind":"fsa_map","farm_number":"1234"}')).toBe("fsa_map");
    expect(kindNamedIn('{"document_kind":"other"}')).toBe("other");
  });

  it("finds it in an answer that was cut off, because the kind comes first", () => {
    expect(kindNamedIn('{"document_kind":"settlement","tickets":[{"number":"209')).toBe("settlement");
    expect(kindNamedIn('  { "document_kind" : "scale_ticket", "gross')).toBe("scale_ticket");
  });

  it("is other when the answer names a kind that isn't on the list", () => {
    expect(kindNamedIn('{"document_kind":"lease"}')).toBe("other");
    expect(kindNamedIn('{"document_kind":"lease","acres_p')).toBe("other");
  });

  it("is null when the answer names no kind", () => {
    expect(kindNamedIn('{"farm_number":"1234"}')).toBeNull();
    expect(kindNamedIn('{"document_kind":null}')).toBeNull();
    expect(kindNamedIn('{"farm_number":"1234","document_kind":"fsa_m')).toBeNull();
    expect(kindNamedIn("null")).toBeNull();
    expect(kindNamedIn("")).toBeNull();
  });
});

describe("readWithClaude", () => {
  const wireSchema = z.object({ acres_pct: z.number().nullable() });
  const request: ReadRequest<typeof wireSchema, { acres: number | null }> = {
    expects: "fsa_578",
    system: "Copy each value.",
    file: photoOrPdfBlock(PDF, "A document"),
    instruction: "Read this document.",
    wireSchema,
    toValues: (wire) => ({ ok: true, values: { acres: wire.acres_pct } }),
  };
  const RIGHT = { document_kind: "fsa_578", acres_pct: 80 };
  const USED = { input_tokens: 6000, output_tokens: 500 };

  it("sends the model, effort, prompt, file and schema, and returns the values with what the read used", async () => {
    const { client, sent } = answeringClient(RIGHT);
    const result = await readWithClaude(request, { model: "haiku", client });

    expect(result).toMatchObject({ model: "haiku", effort: "medium", usage: USED, ok: true, values: { acres: 80 } });
    expect(result.seconds).toBeGreaterThanOrEqual(0);
    expect(result).not.toHaveProperty("wrongKind");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      // The reader's own prompt, with nothing added to it.
      system: "Copy each value.",
      output_config: { effort: "medium", format: { type: "json_schema" } },
      messages: [{ role: "user", content: [request.file, { type: "text", text: "Read this document." }] }],
    });
    expect(sent[0]).not.toHaveProperty("fallbacks");
  });

  it("asks for the kind as the first value, then the reader's own values", async () => {
    const { client, sent } = answeringClient(RIGHT);
    await readWithClaude(request, { model: "haiku", client });
    const schema = sent[0].output_config?.format?.schema as { properties: object; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(["document_kind", "acres_pct"]);
    expect(schema.required).toEqual(["document_kind", "acres_pct"]);
  });

  it("gives the reader its own values without the kind", async () => {
    const { client } = answeringClient(RIGHT);
    let given: unknown;
    const watching = { ...request, toValues: (wire: { acres_pct: number | null }) => ((given = wire), { ok: true as const, values: { acres: 1 } }) };
    await readWithClaude(watching, { model: "haiku", client });
    expect(given).toEqual({ acres_pct: 80 });
  });

  it("uses the effort it is given", async () => {
    const { client, sent } = answeringClient(RIGHT);
    const result = await readWithClaude(request, { model: "sonnet", effort: "high", client });
    expect(result.effort).toBe("high");
    expect(sent[0]).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "high" } });
  });

  it("passes on a reader's own verdict that the values don't fit", async () => {
    const { client } = answeringClient(RIGHT);
    const strict = { ...request, toValues: () => ({ ok: false as const, reason: "The answer didn't fit." }) };
    expect(await readWithClaude(strict, { model: "sonnet", client })).toMatchObject({
      ok: false,
      reason: "The answer didn't fit.",
      usage: USED,
    });
  });

  describe("a file that isn't the kind the reader expects", () => {
    it("comes back refused, with the kind it is, and the reader never sees its values", async () => {
      const { client } = answeringClient({ document_kind: "fsa_map", acres_pct: 80 });
      let asked = false;
      const watching = { ...request, toValues: () => ((asked = true), { ok: true as const, values: { acres: 80 } }) };
      const result = await readWithClaude(watching, { model: "haiku", client });

      expect(result).toMatchObject({ ok: false, wrongKind: "fsa_map", reason: "The file is an FSA map, not an FSA-578.", usage: USED });
      expect(result).not.toHaveProperty("values");
      expect(asked).toBe(false);
    });

    it.each(["other", "lease"])("is refused when it is none of the kinds: %s", async (named) => {
      const { client } = answeringClient({ document_kind: named, acres_pct: null });
      expect(await readWithClaude(request, { model: "haiku", client })).toMatchObject({
        ok: false,
        wrongKind: "other",
        reason: "The file is not an FSA-578, or any other kind of document GrainClaim reads.",
      });
    });

    it.each([
      ["the rest of the answer doesn't fit the schema", { document_kind: "settlement", acres_pct: "eighty" }, {}],
      ["the rest of the answer is missing", { document_kind: "settlement" }, {}],
      ["the answer was cut off", '{"document_kind":"settlement","acres_p', { stop_reason: "max_tokens" }],
      ["the model stopped as a refusal after naming it", '{"document_kind":"settlement"', { stop_reason: "refusal", stop_details: null }],
    ] as const)("is reported as the wrong kind, never as a failed read, when %s", async (_when, answer, more) => {
      const { client } = answeringClient(answer, more);
      const result = await readWithClaude(request, { model: "haiku", client });
      expect(result).toMatchObject({ ok: false, wrongKind: "settlement", reason: "The file is a settlement, not an FSA-578." });
    });
  });

  it.each([
    [RIGHT, { stop_reason: "refusal", stop_details: { category: "cyber" } }, "The model declined to read the document (cyber)."],
    [RIGHT, { stop_reason: "refusal", stop_details: null }, "The model declined to read the document."],
    ['{"document_kind":"fsa_578","acres_p', { stop_reason: "max_tokens" }, "The answer was cut off before it finished."],
    [RIGHT, { content: [] }, "The model returned no values."],
    ["Here is what I found.", {}, "The answer wasn't JSON."],
  ])("returns a failed read, and no wrong kind, for %j %j", async (answer, more, reason) => {
    const { client } = answeringClient(answer, more);
    const result = await readWithClaude(request, { model: "sonnet", client });
    expect(result).toMatchObject({ ok: false, reason, usage: USED });
    expect(result).not.toHaveProperty("wrongKind");
  });

  it.each([
    [{ document_kind: "fsa_578", acres_pct: "eighty" }, /^The answer didn't fit the schema it was asked for \(acres_pct: /],
    [{ acres_pct: 80 }, /^The answer didn't fit the schema it was asked for \(document_kind: /],
  ])("returns a failed read when the answer doesn't fit the schema: %j", async (answer, reason) => {
    const { client } = answeringClient(answer);
    const result = await readWithClaude(request, { model: "sonnet", client });
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(reason), usage: USED });
    expect(result).not.toHaveProperty("wrongKind");
  });

  it("throws errors from the API itself", async () => {
    const rateLimited = new Anthropic.RateLimitError(429, undefined, "slow down", new Headers());
    const client = { messages: { create: async () => Promise.reject(rateLimited) } } as unknown as Anthropic;
    await expect(readWithClaude(request, { model: "sonnet", client })).rejects.toBe(rateLimited);
  });
});
