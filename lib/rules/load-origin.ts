/**
 * "Which field or bin did this load come from?" This is the one place that
 * answers it for a ticket.
 *
 * THIN SLICE: every load comes from North 80. Milestone 4 replaces the body
 * of `originOfLoad` with the matching rules in spec Part 4 (a field printed
 * on the ticket, then the harvest log at the ticket's printed date and time,
 * then a waiting pickup). Callers already pass the ticket's values and act on
 * whatever origin comes back, so they shouldn't need to change.
 */
import { RuleInputError } from "./errors";

/** The ticket values the matching rules use. Null means the value wasn't read. */
export interface OriginTicket {
  buyer_name: string | null;
  /** YYYY-MM-DD, as printed. */
  ticket_date: string | null;
  /** Time in, 24-hour HH:MM, as printed. */
  ticket_time: string | null;
}

export interface OriginInput {
  ticket: OriginTicket;
  /** The farm's current fields. */
  fields: readonly { id: string; name: string }[];
}

/** Where a load came from: a field, or a bin when grain is sold out of storage. */
export type LoadOrigin = { kind: "field"; fieldId: string } | { kind: "bin"; binId: string };

const THIN_SLICE_FIELD = "North 80";

export function originOfLoad({ fields }: OriginInput): LoadOrigin {
  const field = fields.find((f) => f.name === THIN_SLICE_FIELD);
  if (!field) {
    throw new RuleInputError(
      `${THIN_SLICE_FIELD} isn't on the farm map yet, so this ticket can't be linked to a field.`,
    );
  }
  return { kind: "field", fieldId: field.id };
}
