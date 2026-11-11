/**
 * One saved ticket as the result screen shows it: what was read, what was
 * calculated, where the load came from and how the checks came out. Loaded
 * from the database by lib/db/ticket-result.ts, so the screen shows what was
 * stored, not what the upload thought it stored.
 */
import type { TicketCheck } from "../rules/ticket-checks";

export interface TicketResult {
  id: string;
  /** When it was added (ISO time). */
  uploadedAt: string;

  /** The read values, as read. Null means the value wasn't on the ticket or couldn't be read. */
  read: {
    buyer_name: string | null;
    ticket_number: string | null;
    /** YYYY-MM-DD. */
    ticket_date: string | null;
    /** Time in, 24-hour, as HH:MM or HH:MM:SS. */
    ticket_time: string | null;
    truck_number: string | null;
    crop: string | null;
    contract_number: string | null;
    gross_lbs: number | null;
    tare_lbs: number | null;
    net_lbs: number | null;
    moisture_pct: number | null;
    test_weight: number | null;
    foreign_material_pct: number | null;
    damage_pct: number | null;
    dockage_pct: number | null;
  };

  /** The bushel figures printed on the ticket itself. */
  printed: {
    wet_bu: number | null;
    shrink_pct: number | null;
    elevator_dry_bu: number | null;
  };

  /** Our figures, calculated from gross, tare and moisture. */
  calculated: {
    wet_bu: number | null;
    elevator_dry_bu: number | null;
    production_to_count_bu: number | null;
  };

  /** The trip this ticket closed, or null when it has none. */
  origin: {
    fieldName: string | null;
    /** Null when the field has no season in the trip's crop year, or isn't insured. */
    unitNumber: string | null;
    /** False when the field's season that year isn't insured: the ticket then counts toward no unit's total. */
    insured: boolean | null;
    tripCode: string;
  } | null;

  /** Set when this is a second photo of a ticket already on record. It isn't counted. */
  duplicateOf: { ticketNumber: string | null; uploadedAt: string } | null;

  checks: TicketCheck[];
}
