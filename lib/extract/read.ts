/**
 * One read of one document with Claude structured outputs. Every reader
 * (ticket, FSA-578, Summary of Coverage, FSA map) sends its own prompt and
 * schema through `readWithClaude`, and says which kind of document it expects.
 *
 * In the same read, Claude also says what the document is (`document_kind`).
 * A file that isn't the expected kind comes back as a failed read that names
 * the kind it is, so nothing is saved from it and the farmer can be told.
 *
 * Server-side only: the Anthropic client takes ANTHROPIC_API_KEY from the
 * environment. Never import this from a client component.
 *
 * No fallback model is set, so the model that was asked is the model that
 * answered; a refusal comes back as a failed read.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { aDocumentOfKind, SEEN_KINDS, type DocumentKindName, type SeenKind } from "../rules/document-kind";
import { READ_MODELS, type ReadModelKey, type ReadUsage } from "./models";

export type ReadEffort = "low" | "medium" | "high";
export const DEFAULT_READ_EFFORT: ReadEffort = "medium";

/** Values that fit the app's schema, or one sentence saying why they don't. */
export type Validated<T> = { ok: true; values: T } | { ok: false; reason: string };

/** A read that gave no values. */
export interface ReadFailure {
  ok: false;
  /** One sentence saying why, for the server log and the command line. */
  reason: string;
  /** Set when the file isn't the kind of document the reader expects: what Claude says it is. */
  wrongKind?: SeenKind;
}

export type ReadResult<T> = {
  model: ReadModelKey;
  effort: ReadEffort;
  /** How long the read took. */
  seconds: number;
  /** Tokens billed. */
  usage: ReadUsage;
} & ({ ok: true; values: T } | ReadFailure);

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

export interface ReadRequest<Wire extends z.ZodObject, T> {
  /** The kind of document this reader reads. A file of any other kind is not read. */
  expects: DocumentKindName;
  system: string;
  file: FileBlock;
  /** What to do with the file, such as "Read this scale ticket." */
  instruction: string;
  /** The schema Claude fills in. */
  wireSchema: Wire;
  /** Turns Claude's answer into the app's values and holds them to the app's schema. */
  toValues: (wire: z.infer<Wire>) => Validated<T>;
}

// ---------------------------------------------------------------------------
// What the document is
// ---------------------------------------------------------------------------

/** The value Claude fills in first: what the document is. Sent with every reader's schema. */
export const KIND_VALUE = "document_kind";

/**
 * The kind, as Claude is asked for it. Everything the model is told about it
 * is here, in the value's own description, and nothing is added to a reader's
 * prompt: the prompt a reader was measured with is the prompt it sends.
 *
 * The SDK sends a list of choices inside the description, as it does for
 * every list of choices in the readers' schemas, and the answer is held to
 * the list here.
 */
function seenKindSchema(expected: DocumentKindName) {
  return z.enum(SEEN_KINDS).describe(
    [
      `What kind of document the file is. Decide this first, before you read any other value. Go by what the document itself is, not by what you were asked to read. A photo, a scan or a copy of a document, or one marked as a sample, is still that kind of document. If it is not ${aDocumentOfKind(expected)}, don't read it as one: leave every other value empty (null for a number or a date, "" for text, the "not there" choice for a value picked from a list, and no rows in a table).`,
      "Answer with exactly one of these names.",
      "fsa_578: an FSA-578, the Farm Service Agency's Report of Acreage. A form that lists a farm's tracts and fields with the crop, acres and producer shares reported on each.",
      "summary_of_coverage: a crop insurance Summary of Coverage (also called a Schedule of Insurance), from an insurance company. It lists a policy's crops, units, acres, guarantees and premium.",
      "fsa_map: a Farm Service Agency map of a farm. An aerial photo with field outlines drawn on it, each labeled with a field number and acres.",
      "scale_ticket: a grain scale ticket for one truckload, with its gross, tare and net weights.",
      "settlement: a grain settlement sheet from a buyer. It lists several scale tickets with their bushels, a price, deductions and a net payment.",
      "other: anything else, or a file too unclear to tell.",
    ].join("\n"),
  );
}

/** A reader's schema with the kind as its first value, so it is decided before anything is read. */
function withKind(wireSchema: z.ZodObject, expected: DocumentKindName) {
  return z.object({ [KIND_VALUE]: seenKindSchema(expected), ...wireSchema.shape });
}

const isSeenKind = (value: unknown): value is SeenKind => (SEEN_KINDS as readonly unknown[]).includes(value);
const OPENS_WITH_KIND = new RegExp(`^\\s*\\{\\s*"${KIND_VALUE}"\\s*:\\s*"([^"]*)"`);

/**
 * The kind an answer names, or null when it names none. The kind is the
 * answer's first value, so it is found even in an answer that was cut off.
 * A name that isn't on the list is "other": the model called the document
 * something GrainClaim doesn't read.
 */
export function kindNamedIn(answer: string): SeenKind | null {
  let named: unknown;
  try {
    const parsed: unknown = JSON.parse(answer);
    named = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[KIND_VALUE] : undefined;
  } catch {
    named = OPENS_WITH_KIND.exec(answer)?.[1];
  }
  if (typeof named !== "string") return null;
  return isSeenKind(named) ? named : "other";
}

function wrongKindReason(expected: DocumentKindName, seen: SeenKind): string {
  if (seen === "other") return `The file is not ${aDocumentOfKind(expected)}, or any other kind of document GrainClaim reads.`;
  return `The file is ${aDocumentOfKind(seen)}, not ${aDocumentOfKind(expected)}.`;
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * Sends the file and returns the values read from it. A file that isn't the
 * expected kind of document, and a read the model refused, cut short or
 * returned in the wrong shape, come back as `ok: false`. Errors from the API
 * itself (a bad key, a rate limit, no network) are thrown.
 *
 * The kind is looked at before anything else in the answer, so a file of the
 * wrong kind is always reported as that and never as a read that failed.
 */
export async function readWithClaude<Wire extends z.ZodObject, T>(
  request: ReadRequest<Wire, T>,
  options: ReadOptions,
): Promise<ReadResult<T>> {
  const { model, effort = DEFAULT_READ_EFFORT } = options;
  const client = options.client ?? readerClient();
  const started = performance.now();
  const answerSchema = withKind(request.wireSchema, request.expects);

  const message = await client.messages.create({
    model: READ_MODELS[model].id,
    max_tokens: 16000,
    system: request.system,
    output_config: { effort, format: zodOutputFormat(answerSchema) },
    messages: [{ role: "user", content: [request.file, { type: "text", text: request.instruction }] }],
  });

  const result = {
    model,
    effort,
    seconds: (performance.now() - started) / 1000,
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  };
  const failed = (reason: string): ReadResult<T> => ({ ...result, ok: false, reason });
  const answer = message.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text ?? null;

  // First, what the document is.
  const seen = answer === null ? null : kindNamedIn(answer);
  if (seen !== null && seen !== request.expects) {
    return { ...result, ok: false, reason: wrongKindReason(request.expects, seen), wrongKind: seen };
  }

  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    return failed(`The model declined to read the document${category ? ` (${category})` : ""}.`);
  }
  if (message.stop_reason === "max_tokens") return failed("The answer was cut off before it finished.");
  if (answer === null) return failed("The model returned no values.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return failed("The answer wasn't JSON.");
  }
  const checked = answerSchema.safeParse(parsed);
  if (!checked.success) {
    const issues = checked.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return failed(`The answer didn't fit the schema it was asked for (${issues.join("; ")}).`);
  }

  // The reader gets its own values, without the kind.
  const wire: Record<string, unknown> = { ...(checked.data as Record<string, unknown>) };
  delete wire[KIND_VALUE];
  return { ...result, ...request.toValues(wire as z.infer<Wire>) };
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
