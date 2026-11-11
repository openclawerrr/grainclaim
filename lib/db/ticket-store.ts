/**
 * The database and Storage calls behind lib/tickets/add-ticket.ts.
 *
 * The demo has one farm and no logins, so nothing here filters by insured.
 * The REST API has no transactions; add-ticket.ts orders these calls so a
 * failure part-way can be retried.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SavedTicketIdentity } from "../rules/ticket-matching";
import type { FarmRecords, TicketStore } from "../tickets/add-ticket";
import { PHOTO_BUCKET } from "./client";

function fail(doing: string, error: { message: string }): never {
  throw new Error(`${doing} failed: ${error.message}`);
}

/** Storage answers "already exists" when these exact bytes were stored before. */
export function alreadyStored(error: { message?: string; status?: number; statusCode?: string; code?: string }): boolean {
  return (
    error.code === "ResourceAlreadyExists" ||
    error.status === 409 ||
    error.statusCode === "409" ||
    /already exists/i.test(error.message ?? "")
  );
}

export function ticketStore(db: SupabaseClient): TicketStore {
  return {
    async findTicketByHash(hash) {
      const { data, error } = await db.from("ticket").select("id").eq("photo_sha256", hash).maybeSingle();
      if (error) fail("Looking up the photo's hash", error);
      return data;
    },

    async loadFarmRecords(): Promise<FarmRecords> {
      const [fields, fieldSeasons, trucks, buyers] = await Promise.all([
        db.from("field").select("id, name").is("valid_to", null),
        db.from("field_season").select("field_id, crop_year, crop, planting_completed_date"),
        db.from("truck").select("id, name, capacity_bu").eq("owner", "farm"),
        db.from("buyer").select("id, name"),
      ]);
      if (fields.error) fail("Reading fields", fields.error);
      if (fieldSeasons.error) fail("Reading field seasons", fieldSeasons.error);
      if (trucks.error) fail("Reading trucks", trucks.error);
      if (buyers.error) fail("Reading buyers", buyers.error);
      return { fields: fields.data, fieldSeasons: fieldSeasons.data, trucks: trucks.data, buyers: buyers.data };
    },

    async findTicketsByNumberAndDate(ticketNumber, ticketDate): Promise<SavedTicketIdentity[]> {
      const { data, error } = await db
        .from("ticket")
        .select("id, buyer_name, ticket_number, ticket_date, duplicate_of, uploaded_at")
        .eq("ticket_number", ticketNumber)
        .eq("ticket_date", ticketDate);
      if (error) fail("Checking for the same ticket", error);
      return data;
    },

    async savePhoto(path, photo, type) {
      const { error } = await db.storage
        .from(PHOTO_BUCKET)
        .upload(path, photo, { contentType: type.mediaType, upsert: false });
      if (error && !alreadyStored(error)) fail("Storing the photo", error);
    },

    async insertTrip(trip) {
      const { data, error } = await db.from("trip").insert(trip).select("id").single();
      if (error) fail("Saving the trip", error);
      return data;
    },

    async deleteTrip(id) {
      const { error } = await db.from("trip").delete().eq("id", id);
      if (error) fail("Removing the trip", error);
    },

    async insertTicket(ticket) {
      const { data, error } = await db.from("ticket").insert(ticket).select("id").single();
      if (error) fail("Saving the ticket", error);
      return data;
    },
  };
}
