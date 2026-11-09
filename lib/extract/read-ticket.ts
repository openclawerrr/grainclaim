/**
 * Reads one scale ticket photo with Claude structured outputs.
 *
 * Server-side only: the Anthropic client takes ANTHROPIC_API_KEY from the
 * environment. Never import this from a client component.
 *
 * No fallback model is set, so the model that was asked is the model that
 * answered; a refusal comes back as a failed read.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { READ_MODELS, type ReadModelKey, type ReadUsage } from "./models";
import { fromWire, ticketReadSchema, ticketWireSchema, type TicketRead } from "./ticket-schema";

export type ReadEffort = "low" | "medium" | "high";
export const DEFAULT_READ_EFFORT: ReadEffort = "medium";

/**
 * The model copies; lib/rules/ticket-checks.ts checks. If the model worked
 * net out from gross and tare, "gross − tare = net" would pass on a misread.
 */
const SYSTEM_PROMPT = `You read photos of grain scale tickets for a farm's records. A ticket may be printed, filled in by hand, or both.

Copy each value exactly as it appears on the ticket in the photo.

- Read every value on its own. Never work one value out from others: don't subtract, multiply or divide, and don't change a value so the ticket adds up. If the net weight written on the ticket doesn't equal gross minus tare, report all three as written. Arithmetic checks run on your answer afterwards, and they only catch mistakes if each value is what the ticket shows.
- With handwriting, read each digit by its shape. If a digit could be two different numbers, give the one its shape is closest to.
- If a value is blank, isn't on this ticket, or can't be read at all, say so: null for a number or the date, "" for text, and "unmarked" for a set of boxes with none marked. Never fill a gap with a likely value.
- For boxes, report the one that is marked.`;

export type TicketReadResult = {
  model: ReadModelKey;
  effort: ReadEffort;
  /** How long the read took. */
  seconds: number;
  /** Tokens billed. Zero when the answer came back but wasn't the JSON the schema asks for. */
  usage: ReadUsage;
} & ({ ok: true; values: TicketRead } | { ok: false; reason: string });

let sharedClient: Anthropic | undefined;

function readerClient(): Anthropic {
  if (typeof window !== "undefined") {
    throw new Error("Ticket reading uses ANTHROPIC_API_KEY and must never run in a browser.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see SETUP.md).");
  }
  sharedClient ??= new Anthropic();
  return sharedClient;
}

function mediaTypeOf(photo: Uint8Array): "image/jpeg" | "image/png" {
  if (photo[0] === 0xff && photo[1] === 0xd8) return "image/jpeg";
  if (photo[0] === 0x89 && photo[1] === 0x50 && photo[2] === 0x4e && photo[3] === 0x47) return "image/png";
  throw new Error("A ticket photo must be a JPEG or PNG file.");
}

export interface ReadTicketOptions {
  model: ReadModelKey;
  effort?: ReadEffort;
  /** For tests. Defaults to a client that reads ANTHROPIC_API_KEY from the environment. */
  client?: Anthropic;
}

/**
 * Sends the photo as it was taken and returns the values read from it.
 * A read the model refused, cut short or returned in the wrong shape comes
 * back as `ok: false`. Errors from the API itself (a bad key, a rate limit,
 * no network) are thrown.
 */
export async function readTicket(photo: Uint8Array, options: ReadTicketOptions): Promise<TicketReadResult> {
  const { model, effort = DEFAULT_READ_EFFORT } = options;
  const mediaType = mediaTypeOf(photo);
  const client = options.client ?? readerClient();
  const started = performance.now();
  const base = () => ({ model, effort, seconds: (performance.now() - started) / 1000 });

  let message;
  try {
    message = await client.messages.parse({
      model: READ_MODELS[model].id,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort, format: zodOutputFormat(ticketWireSchema) },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: Buffer.from(photo).toString("base64") },
            },
            { type: "text", text: "Read this scale ticket." },
          ],
        },
      ],
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
    return { ...result, ok: false, reason: `The model declined to read the photo${category ? ` (${category})` : ""}.` };
  }
  if (message.stop_reason === "max_tokens") {
    return { ...result, ok: false, reason: "The answer was cut off before it finished." };
  }
  if (!message.parsed_output) {
    return { ...result, ok: false, reason: "The model returned no values." };
  }
  return { ...result, ...validateRead(fromWire(message.parsed_output)) };
}

/** Holds the answer to the app's schema: a time that isn't HH:MM fails the read rather than being stored. */
export function validateRead(values: unknown): { ok: true; values: TicketRead } | { ok: false; reason: string } {
  const checked = ticketReadSchema.safeParse(values);
  if (checked.success) return { ok: true, values: checked.data };
  const issues = checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { ok: false, reason: `The answer didn't fit the ticket schema (${issues.join("; ")}).` };
}

function firstLine(text: string): string {
  return text.split("\n")[0];
}
