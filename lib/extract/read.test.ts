import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { photoBlock, photoOrPdfBlock, readWithClaude, validateAgainst, type ReadRequest } from "./read";

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

describe("readWithClaude", () => {
  const wireSchema = z.object({ acres_pct: z.number().nullable() });
  const request: ReadRequest<typeof wireSchema, { acres: number | null }> = {
    system: "Copy each value.",
    file: photoOrPdfBlock(PDF, "A document"),
    instruction: "Read this document.",
    wireSchema,
    toValues: (wire) => ({ ok: true, values: { acres: wire.acres_pct } }),
  };

  /** A stand-in for the API that records what it was sent and answers with `message`, or throws it. */
  function fakeClient(message: object | Error) {
    const sent: Anthropic.MessageCreateParams[] = [];
    const client = {
      messages: {
        parse: async (params: Anthropic.MessageCreateParams) => {
          sent.push(params);
          if (message instanceof Error) throw message;
          return message;
        },
      },
    } as unknown as Anthropic;
    return { client, sent };
  }
  const answered = (more: object) => ({ stop_reason: "end_turn", usage: { input_tokens: 6000, output_tokens: 500 }, ...more });

  it("sends the model, effort, prompt, file and schema, and returns the values with what the read used", async () => {
    const { client, sent } = fakeClient(answered({ parsed_output: { acres_pct: 80 } }));
    const result = await readWithClaude(request, { model: "haiku", client });

    expect(result).toMatchObject({
      model: "haiku",
      effort: "medium",
      usage: { input_tokens: 6000, output_tokens: 500 },
      ok: true,
      values: { acres: 80 },
    });
    expect(result.seconds).toBeGreaterThanOrEqual(0);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      system: "Copy each value.",
      output_config: { effort: "medium", format: { type: "json_schema" } },
      messages: [{ role: "user", content: [request.file, { type: "text", text: "Read this document." }] }],
    });
    expect(sent[0]).not.toHaveProperty("fallbacks");
  });

  it("uses the effort it is given", async () => {
    const { client, sent } = fakeClient(answered({ parsed_output: { acres_pct: 80 } }));
    const result = await readWithClaude(request, { model: "sonnet", effort: "high", client });
    expect(result.effort).toBe("high");
    expect(sent[0]).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "high" } });
  });

  it("passes on a reader's own verdict that the values don't fit", async () => {
    const { client } = fakeClient(answered({ parsed_output: { acres_pct: 80 } }));
    const strict = { ...request, toValues: () => ({ ok: false as const, reason: "The answer didn't fit." }) };
    expect(await readWithClaude(strict, { model: "sonnet", client })).toMatchObject({
      ok: false,
      reason: "The answer didn't fit.",
      usage: { input_tokens: 6000, output_tokens: 500 },
    });
  });

  it.each([
    [{ stop_reason: "refusal", stop_details: { category: "cyber" } }, "The model declined to read the document (cyber)."],
    [{ stop_reason: "refusal", stop_details: null }, "The model declined to read the document."],
    [{ stop_reason: "max_tokens" }, "The answer was cut off before it finished."],
    [{ parsed_output: null }, "The model returned no values."],
  ])("returns a failed read for %j", async (more, reason) => {
    const { client } = fakeClient(answered(more));
    expect(await readWithClaude(request, { model: "sonnet", client })).toMatchObject({ ok: false, reason });
  });

  it("returns a failed read when the answer isn't the JSON the schema asks for", async () => {
    const { client } = fakeClient(new Anthropic.AnthropicError("Failed to parse structured output\nat line 1"));
    expect(await readWithClaude(request, { model: "sonnet", client })).toMatchObject({
      ok: false,
      reason: "Failed to parse structured output",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  });

  it("throws errors from the API itself", async () => {
    const rateLimited = new Anthropic.RateLimitError(429, undefined, "slow down", new Headers());
    await expect(readWithClaude(request, { model: "sonnet", client: fakeClient(rateLimited).client })).rejects.toBe(rateLimited);
  });
});
