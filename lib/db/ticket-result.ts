/** Loads one saved ticket with its trip, field and unit, for the result screen. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TicketCheck } from "../rules/ticket-checks";
import type { TicketResult } from "../tickets/ticket-result";

const READ_COLUMNS = [
  "buyer_name",
  "ticket_number",
  "ticket_date",
  "ticket_time",
  "truck_number",
  "crop",
  "contract_number",
  "gross_lbs",
  "tare_lbs",
  "net_lbs",
  "moisture_pct",
  "test_weight",
  "foreign_material_pct",
  "damage_pct",
  "dockage_pct",
] as const satisfies readonly (keyof TicketResult["read"])[];

interface TicketRow extends Record<(typeof READ_COLUMNS)[number], unknown> {
  id: string;
  uploaded_at: string;
  other_printed_values: Record<string, unknown> | null;
  read_confidence: { checks?: unknown } | null;
  wet_bu: number | null;
  elevator_dry_bu: number | null;
  production_to_count_bu: number | null;
  trip: {
    trip_code: string;
    crop_year: number;
    origin_field_id: string | null;
    field: { name: string } | null;
  } | null;
  original: { ticket_number: string | null; uploaded_at: string } | null;
}

const numberOrNull = (value: unknown): number | null => (typeof value === "number" ? value : null);

export async function loadTicketResult(db: SupabaseClient, ticketId: string): Promise<TicketResult | null> {
  const { data, error } = await db
    .from("ticket")
    .select(
      `id, uploaded_at, ${READ_COLUMNS.join(", ")}, other_printed_values, read_confidence,
       wet_bu, elevator_dry_bu, production_to_count_bu,
       trip(trip_code, crop_year, origin_field_id, field(name)),
       original:duplicate_of(ticket_number, uploaded_at)`,
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(`Reading the ticket failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as TicketRow;

  // The field's season in the trip's crop year gives the unit.
  let unitNumber: string | null = null;
  if (row.trip?.origin_field_id) {
    const season = await db
      .from("field_season")
      .select("unit(unit_number)")
      .eq("field_id", row.trip.origin_field_id)
      .eq("crop_year", row.trip.crop_year)
      .maybeSingle();
    if (season.error) throw new Error(`Reading the field's season failed: ${season.error.message}`);
    unitNumber = (season.data as unknown as { unit: { unit_number: string } | null } | null)?.unit?.unit_number ?? null;
  }

  const printed = row.other_printed_values ?? {};
  const checks = row.read_confidence?.checks;
  return {
    id: row.id,
    uploadedAt: row.uploaded_at,
    read: Object.fromEntries(READ_COLUMNS.map((column) => [column, row[column] ?? null])) as TicketResult["read"],
    printed: {
      wet_bu: numberOrNull(printed.wet_bu),
      shrink_pct: numberOrNull(printed.shrink_pct),
      elevator_dry_bu: numberOrNull(printed.elevator_dry_bu),
    },
    calculated: {
      wet_bu: row.wet_bu,
      elevator_dry_bu: row.elevator_dry_bu,
      production_to_count_bu: row.production_to_count_bu,
    },
    origin: row.trip
      ? { fieldName: row.trip.field?.name ?? null, unitNumber, tripCode: row.trip.trip_code }
      : null,
    duplicateOf: row.original
      ? { ticketNumber: row.original.ticket_number, uploadedAt: row.original.uploaded_at }
      : null,
    checks: Array.isArray(checks) ? (checks as TicketCheck[]) : [],
  };
}
