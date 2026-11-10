/**
 * One read of one document with Claude structured outputs. Every reader
 * (ticket, FSA-578, Summary of Coverage) sends its own prompt and schema
 * through `readWithClaude`.
 *
 * Server-side only: the Anthropic client takes ANTHROPIC_API_KEY from the
 * environment. Never import this from a client component.
 *
 * No fallback model is set, so the model that was asked is the model that
 * answered; a refusal comes back as a failed read.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { READ_MODELS, type ReadModelKey, type ReadUsage } from "./models";

export type ReadEffort = "low" | "medium" | "high";
export const DEFAULT_READ_EFFORT: ReadEffort = "medium";

/** Values that fit the app's schema, or one sentence saying why they don't. */
export type Validated<T> = { ok: true; values: T } | { ok: false; reason: string };

export type ReadResult<T> = {
  model: ReadModelKey;
  effort: ReadEffort;
  /** How long the read took. */
  seconds: number;
  /** Tokens billed. Zero when the answer came back but wasn't the JSON the schema asks for. */
  usage: ReadUsage;
} & Validated<T>;

export interface ReadOptions {
  model: ReadModelKey;
  effort?: ReadEffort;
  /** For tests. Defaults to a client that reads ANTHROPIC_API_KEY from the environment. */
  client?: Anthropic;
}

/** A photo or PDF as Claude takes it. */
export type FileBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam;

let sharedClient: Anthropic | undefined;

function readerClient(): Anthropic {
  if (typeof window !== "undefined") {
    throw new Error("Document reading uses ANTHROPIC_API_KEY and must never run in a browser.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see SETUP.md).");
  }
  sharedClient ??= new Anthropic();
  return sharedClient;
}

const base64 = (file: Uint8Array) => Buffer.from(file).toString("base64");

function photoMediaType(file: Uint8Array): "image/jpeg" | "image/png" | null {
  if (file[0] === 0xff && file[1] === 0xd8) return "image/jpeg";
  if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47) return "image/png";
  return null;
}

// "%PDF"
const isPdf = (file: Uint8Array) => file[0] === 0x25 && file[1] === 0x50 && file[2] === 0x44 && file[3] === 0x46;

/** A photo, sent as it was taken. `what` names it in the error: "A ticket photo". */
export function photoBlock(photo: Uint8Array, what: string): Anthropic.ImageBlockParam {
  const mediaType = photoMediaType(photo);
  if (!mediaType) throw new Error(`${what} must be a JPEG or PNG file.`);
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64(photo) } };
}

/** A photo or the PDF itself, for documents that arrive either way. `what` names it in the error. */
export function photoOrPdfBlock(file: Uint8Array, what: string): FileBlock {
  if (isPdf(file)) {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64(file) } };
  }
  if (!photoMediaType(file)) throw new Error(`${what} must be a JPEG or PNG photo, or a PDF.`);
  return photoBlock(file, what);
}

export interface ReadRequest<Wire extends z.ZodType, T> {
  system: string;
  file: FileBlock;
  /** What to do with the file, such as "Read this scale ticket." */
  instruction: string;
  /** The schema Claude fills in. */
  wireSchema: Wire;
  /** Turns Claude's answer into the app's values and holds them to the app's schema. */
  toValues: (wire: z.infer<Wire>) => Validated<T>;
}

/**
 * Sends the file and returns the values read from it. A read the model
 * refused, cut short or returned in the wrong shape comes back as
 * `ok: false`. Errors from the API itself (a bad key, a rate limit, no
 * network) are thrown.
 */
export async function readWithClaude<Wire extends z.ZodType, T>(
  request: ReadRequest<Wire, T>,
  options: ReadOptions,
): Promise<ReadResult<T>> {
  const { model, effort = DEFAULT_READ_EFFORT } = options;
  const client = options.client ?? readerClient();
  const started = performance.now();
  const base = () => ({ model, effort, seconds: (performance.now() - started) / 1000 });

  let message;
  try {
    message = await client.messages.parse({
      model: READ_MODELS[model].id,
      max_tokens: 16000,
      system: request.system,
      output_config: { effort, format: zodOutputFormat(request.wireSchema) },
      messages: [{ role: "user", content: [request.file, { type: "text", text: request.instruction }] }],
    });
  } catch (error) {
    // The API answered, but not with JSON that fits the schema.
    if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
      return {
        ...base(),
        usage: { input_tokens: 0, output_tokens: 0 },
        ok: false,
        reason: firstLine(error.message),
      };
    }
    throw error;
  }

  const result = {
    ...base(),
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  };
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    return { ...result, ok: false, reason: `The model declined to read the document${category ? ` (${category})` : ""}.` };
  }
  if (message.stop_reason === "max_tokens") {
    return { ...result, ok: false, reason: "The answer was cut off before it finished." };
  }
  if (!message.parsed_output) {
    return { ...result, ok: false, reason: "The model returned no values." };
  }
  return { ...result, ...request.toValues(message.parsed_output as z.infer<Wire>) };
}

/** Holds values to one of the app's schemas. `name` finishes "The answer didn't fit the … schema". */
export function validateAgainst<Schema extends z.ZodType>(
  schema: Schema,
  values: unknown,
  name: string,
): Validated<z.infer<Schema>> {
  const checked = schema.safeParse(values);
  if (checked.success) return { ok: true, values: checked.data };
  const issues = checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { ok: false, reason: `The answer didn't fit the ${name} schema (${issues.join("; ")}).` };
}

/**
 * The rules every form reader gives the model. The model copies; the checks
 * in lib/rules check. If the model worked a total out from its lines, "the
 * lines add up to the total" would pass on a misread.
 */
export const COPYING_RULES = `Copy each value exactly as it appears on the document.

- Read every value on its own. Never work one value out from others: don't add, subtract, multiply or divide, and don't change a value so the document adds up. If a total written on the document doesn't equal its lines, report the total and the lines as written. Arithmetic checks run on your answer afterwards, and they only catch mistakes if each value is what the document shows.
- A table has one entry for every row that is filled in, in the order the rows appear, and none for blank rows. Keep each value with the row it is written on.
- With handwriting, read each character by its shape. If a digit could be two different numbers, give the one its shape is closest to.
- If a value is blank, isn't on this document, or can't be read at all, say so: null for a number or a date, "" for text, and the "not there" choice for a value picked from a list. Never fill a gap with a likely value.`;

function firstLine(text: string): string {
  return text.split("\n")[0];
}
