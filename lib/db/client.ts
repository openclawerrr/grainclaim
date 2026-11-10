/**
 * The app's database client. Server-side only: it uses SUPABASE_SECRET_KEY,
 * which bypasses Row Level Security. Every table has RLS on and no access
 * rules, so this is the only way the app reads or writes.
 *
 * Never import this from a client component. Keep queries in lib/db/.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** The private Storage bucket for original photos, each named by its SHA-256 hash. */
export const PHOTO_BUCKET = "photos";

let shared: SupabaseClient | undefined;

export function getDb(): SupabaseClient {
  if (shared) return shared;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !secretKey && "SUPABASE_SECRET_KEY"].filter(Boolean);
  if (!url || !secretKey) {
    throw new Error(`Missing in .env.local: ${missing.join(", ")}. See SETUP.md.`);
  }
  if (secretKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY holds a publishable key. The app needs the secret key (sb_secret_...).");
  }

  shared = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return shared;
}
