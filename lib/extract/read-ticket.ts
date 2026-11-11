/**
 * Reads one scale ticket photo with Claude structured outputs. The API call
 * itself, and what counts as a failed read, are in read.ts.
 *
 * Server-side only: the Anthropic client takes ANTHROPIC_API_KEY from the
 * environment. Never import this from a client component.
 */
import {
  photoBlock,
  readWithClaude,
  validateAgainst,
  type ReadOptions,
  type ReadResult,
  type Validated,
} from "./read";
import { fromWire, ticketReadSchema, ticketWireSchema, type TicketRead } from "./ticket-schema";

export { DEFAULT_READ_EFFORT, type ReadEffort } from "./read";

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

export type TicketReadResult = ReadResult<TicketRead>;
export type ReadTicketOptions = ReadOptions;

/**
 * Sends the photo as it was taken and returns the values read from it.
 * A photo that isn't a scale ticket, and a read the model refused, cut short
 * or returned in the wrong shape, come back as `ok: false`. Errors from the API itself (a bad key, a rate limit,
 * no network) are thrown.
 */
export async function readTicket(photo: Uint8Array, options: ReadTicketOptions): Promise<TicketReadResult> {
  return readWithClaude(
    {
      expects: "scale_ticket",
      system: SYSTEM_PROMPT,
      file: photoBlock(photo, "A ticket photo"),
      instruction: "Read this scale ticket.",
      wireSchema: ticketWireSchema,
      toValues: (wire) => validateRead(fromWire(wire)),
    },
    options,
  );
}

/** Holds the answer to the app's schema: a time that isn't HH:MM fails the read rather than being stored. */
export function validateRead(values: unknown): Validated<TicketRead> {
  return validateAgainst(ticketReadSchema, values, "ticket");
}
