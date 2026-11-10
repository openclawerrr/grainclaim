/**
 * Matching a ticket's read values to the farm's own records: its truck, its
 * buyer, and an earlier photo of the same ticket. Pure functions; the caller
 * loads the records.
 *
 * Every match must be the only one. When nothing matches, or two records do,
 * the answer is null: never a guess.
 */

/** Lower case, with runs of spaces collapsed, so "Main  Street ELEVATOR " matches. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "Truck 1", "truck #1", "#1", "No. 1" and "1" all name the same truck. */
function truckKey(text: string): string {
  return normalize(text)
    .replace(/^(truck|trk)\b\.?\s*/, "")
    .replace(/^(no\b\.?|#)\s*/, "")
    .trim();
}

function onlyOne<T>(matches: T[]): T | null {
  return matches.length === 1 ? matches[0] : null;
}

/** The farm truck a ticket's printed truck number names, such as "1" for "Truck 1". */
export function matchFarmTruck<T extends { name: string }>(
  truckNumber: string | null,
  trucks: readonly T[],
): T | null {
  if (truckNumber === null) return null;
  const key = truckKey(truckNumber);
  if (key === "") return null;
  return onlyOne(trucks.filter((truck) => truckKey(truck.name) === key));
}

/** The buyer on record with the name printed on the ticket. */
export function matchBuyer<T extends { name: string }>(buyerName: string | null, buyers: readonly T[]): T | null {
  if (buyerName === null) return null;
  const key = normalize(buyerName);
  if (key === "") return null;
  return onlyOne(buyers.filter((buyer) => normalize(buyer.name) === key));
}

/** What identifies a ticket: who issued it, its number and its date. */
export interface TicketIdentity {
  buyer_name: string | null;
  ticket_number: string | null;
  /** YYYY-MM-DD. */
  ticket_date: string | null;
}

export interface SavedTicketIdentity extends TicketIdentity {
  id: string;
  /** Set when this row is itself a second photo of an earlier ticket. */
  duplicate_of: string | null;
  /** When it was added (ISO time). */
  uploaded_at: string;
}

/**
 * The duplicate check (spec Part 5): the same buyer, ticket number and date
 * is the same ticket, even from a different photo. Returns the first ticket
 * saved with that identity, or null when this one is new. A ticket missing
 * any of the three values can't be compared, so it is never a duplicate.
 */
export function findOriginalTicket<T extends SavedTicketIdentity>(
  ticket: TicketIdentity,
  saved: readonly T[],
): T | null {
  const { buyer_name, ticket_number, ticket_date } = ticket;
  if (buyer_name === null || ticket_number === null || ticket_date === null) return null;

  const same = saved.filter(
    (other) =>
      other.duplicate_of === null &&
      other.buyer_name !== null &&
      other.ticket_number !== null &&
      normalize(other.buyer_name) === normalize(buyer_name) &&
      other.ticket_number.trim() === ticket_number.trim() &&
      other.ticket_date === ticket_date,
  );
  if (same.length === 0) return null;
  return same.reduce((first, other) =>
    Date.parse(other.uploaded_at) < Date.parse(first.uploaded_at) ? other : first,
  );
}
