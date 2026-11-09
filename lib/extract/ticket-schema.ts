/**
 * What a read of one scale ticket returns. Names match the database columns
 * and the answer key in sample-data/documents-2026.json.
 *
 * There are two schemas:
 * - `ticketReadSchema` is what the app uses. Every value can be null: a blank
 *   line, a value this ticket's layout doesn't print, or writing that can't
 *   be read is null, never a guess.
 * - `ticketWireSchema` is what Claude fills in. Structured outputs allow at
 *   most 16 values that are "this or null", and a ticket has 27, so only the
 *   numbers and the date are nullable there. Missing text is "" and an
 *   unmarked box is its own choice. `fromWire` turns those into nulls.
 */
import { z } from "zod";
import { CROPS } from "../rules/crops";

// ---------------------------------------------------------------------------
// What the app uses
// ---------------------------------------------------------------------------

const text = z.string().min(1).nullable();
const pounds = z.number().int().nullable();
const decimal = z.number().nullable();
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ticketReadSchema = z.object({
  // The ticket values in spec Part 2.
  buyer_name: text,
  ticket_number: text,
  /** YYYY-MM-DD. */
  ticket_date: z.iso.date().nullable(),
  /** Time in, as 24-hour HH:MM. Tickets link to the field being harvested at this date and time. */
  ticket_time: z.string().regex(TIME_24H).nullable(),
  crop: z.enum(CROPS).nullable(),
  gross_lbs: pounds,
  tare_lbs: pounds,
  net_lbs: pounds,
  /** Percentage points as written: 17.5 for 17.5%. The same for every _pct value. */
  moisture_pct: decimal,
  test_weight: decimal,
  foreign_material_pct: decimal,
  damage_pct: decimal,
  dockage_pct: decimal,
  truck_number: text,
  /** The buyer's shrink: the moisture it starts at, and the rate per point above it. */
  base_moisture_pct: decimal,
  shrink_pct_per_point: decimal,
  contract_number: text,

  // Other values printed on the ticket.
  buyer_address: text,
  direction: z.enum(["in", "out"]).nullable(),
  purchase_type: z.enum(["storage", "spot", "contract"]).nullable(),
  customer: text,
  /** The grain as written, such as "Yellow Corn". */
  grain: text,
  driver_on: z.boolean().nullable(),
  /** Bushels as written on the ticket, before shrink. */
  wet_bu: decimal,
  /** This load's shrink as written. */
  shrink_pct: decimal,
  elevator_dry_bu: decimal,
  weigher: text,
});

export type TicketRead = z.infer<typeof ticketReadSchema>;
export type TicketField = keyof TicketRead;

/** The read values spec Part 2 lists for a ticket. "Buyer's shrink" is the base moisture and the rate. */
export const PART_2_FIELDS = [
  "buyer_name",
  "ticket_number",
  "ticket_date",
  "ticket_time",
  "crop",
  "gross_lbs",
  "tare_lbs",
  "net_lbs",
  "moisture_pct",
  "test_weight",
  "foreign_material_pct",
  "damage_pct",
  "dockage_pct",
  "truck_number",
  "base_moisture_pct",
  "shrink_pct_per_point",
  "contract_number",
] as const satisfies readonly TicketField[];

/** Everything else printed on a ticket. The bushel and shrink values feed the arithmetic checks. */
export const OTHER_PRINTED_FIELDS = [
  "buyer_address",
  "direction",
  "purchase_type",
  "customer",
  "grain",
  "driver_on",
  "wet_bu",
  "shrink_pct",
  "elevator_dry_bu",
  "weigher",
] as const satisfies readonly TicketField[];

export const TICKET_FIELDS: readonly TicketField[] = [...PART_2_FIELDS, ...OTHER_PRINTED_FIELDS];

// ---------------------------------------------------------------------------
// What Claude fills in
// ---------------------------------------------------------------------------
// The descriptions are sent to the model with the schema. They say where a
// value sits on a ticket and how to write it, never what it should be.

const wireText = (description: string) => z.string().describe(`${description} "" if there is none.`);
const wirePounds = (description: string) => z.number().int().nullable().describe(description);
const wireDecimal = (description: string) => z.number().nullable().describe(description);

export const ticketWireSchema = z.object({
  buyer_name: wireText("The business that issued the ticket (the elevator or other buyer), as printed."),
  ticket_number: wireText("The ticket number, digits exactly as printed."),
  ticket_date: z.iso
    .date()
    .nullable()
    .describe("The date on the ticket, as YYYY-MM-DD. US tickets write month/day/year."),
  ticket_time: z
    .string()
    .describe('The time in (when the truck weighed in), as 24-hour HH:MM: 1:15 PM is "13:15". "" if there is none.'),
  crop: z
    .enum([...CROPS, "other"])
    .describe('Which crop the grain is. Yellow Corn and #2 Corn are corn. "other" if it is none of these or isn\'t written.'),
  gross_lbs: wirePounds("Gross weight in pounds, as written. No thousands separator."),
  tare_lbs: wirePounds("Tare weight in pounds, as written. No thousands separator."),
  net_lbs: wirePounds("Net weight in pounds, as written on the ticket, not gross minus tare."),
  moisture_pct: wireDecimal("Moisture, in percent as written: 17.5 for 17.5%."),
  test_weight: wireDecimal("Test weight in pounds per bushel."),
  foreign_material_pct: wireDecimal("Foreign material (FM), in percent."),
  damage_pct: wireDecimal("Damage, in percent."),
  dockage_pct: wireDecimal("Dockage, in percent. Null if the ticket has no dockage line."),
  truck_number: wireText("The truck number or name."),
  base_moisture_pct: wireDecimal(
    "The buyer's base moisture: shrink applies to moisture above it. Usually in the ticket's printed terms, such as 'per point of moisture over 15.0%'.",
  ),
  shrink_pct_per_point: wireDecimal(
    "The buyer's shrink rate in percent per point of moisture over the base, such as 1.4. Usually in the ticket's printed terms. This is the rate, not this load's shrink.",
  ),
  contract_number: wireText("The contract number."),

  buyer_address: wireText("The buyer's address under its name, on one line with its parts separated by commas."),
  direction: z
    .enum(["in", "out", "unmarked"])
    .describe("Which box is marked: grain received (in) or withdrawn (out)."),
  purchase_type: z
    .enum(["storage", "spot", "contract", "unmarked"])
    .describe("Which box is marked: storage, spot purchase or contract purchase."),
  customer: wireText("The customer the grain was received from, as written."),
  grain: wireText("The grain as written on the ticket, such as 'Yellow Corn'."),
  driver_on: z
    .enum(["on", "off", "unmarked"])
    .describe("Whether the driver was on the scale: which of ON and OFF is marked."),
  wet_bu: wireDecimal("Bushels as written next to the net weight (before shrink)."),
  shrink_pct: wireDecimal("This load's shrink, in percent, as written in the grading box."),
  elevator_dry_bu: wireDecimal("Dry bushels (after shrink), as written."),
  weigher: wireText("The weigher's name or initials."),
});

export type TicketWire = z.infer<typeof ticketWireSchema>;

const textOrNull = (value: string) => value.trim() || null;

/** Claude's answer as the app's values: "" and unmarked boxes become null. Not yet validated. */
export function fromWire(wire: TicketWire): Record<TicketField, unknown> {
  return {
    ...wire,
    buyer_name: textOrNull(wire.buyer_name),
    ticket_number: textOrNull(wire.ticket_number),
    ticket_time: textOrNull(wire.ticket_time),
    crop: wire.crop === "other" ? null : wire.crop,
    truck_number: textOrNull(wire.truck_number),
    contract_number: textOrNull(wire.contract_number),
    buyer_address: textOrNull(wire.buyer_address),
    direction: wire.direction === "unmarked" ? null : wire.direction,
    purchase_type: wire.purchase_type === "unmarked" ? null : wire.purchase_type,
    customer: textOrNull(wire.customer),
    grain: textOrNull(wire.grain),
    driver_on: wire.driver_on === "unmarked" ? null : wire.driver_on === "on",
    weigher: textOrNull(wire.weigher),
  };
}
