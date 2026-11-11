/**
 * Open flags, for the Needs attention list on the farmer's home screen. Each
 * is one plain sentence that says what is wrong.
 *
 * The demo has one farm and no logins, so nothing here filters by insured.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OpenFlag {
  id: string;
  /** acre_mismatch, unreported_field, and so on. */
  type: string;
  message: string;
}

/** Every open flag, oldest first. */
export async function loadOpenFlags(db: SupabaseClient): Promise<OpenFlag[]> {
  const { data, error } = await db.from("flag").select("id, flag_type, message").eq("status", "open").order("created_at");
  if (error) throw new Error(`Reading flags failed: ${error.message}`);
  return (data as { id: string; flag_type: string; message: string }[]).map((row) => ({
    id: row.id,
    type: row.flag_type,
    message: row.message,
  }));
}
