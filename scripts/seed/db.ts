/**
 * Database client for the seed script. Server-side only: it uses
 * SUPABASE_SECRET_KEY, which bypasses Row Level Security. Never import this
 * from app code. Values from .env.local are never printed.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ENV_FILE = ".env.local";

function loadEnvFile(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${ENV_FILE} not found. Create it from the template in SETUP.md.`);
    }
    throw err;
  }
}

export function createSeedClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("The seed client uses the secret key and must never run in a browser.");
  }
  loadEnvFile();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !secretKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (!url || !secretKey) {
    throw new Error(`Missing in ${ENV_FILE}: ${missing.join(", ")}. See SETUP.md.`);
  }
  if (secretKey.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SECRET_KEY holds a publishable key. The seed needs the secret key (sb_secret_...).",
    );
  }

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
