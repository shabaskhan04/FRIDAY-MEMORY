import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client authenticated with the service role key.
 * Use ONLY in server-side API routes — never expose to the browser.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !serviceKey) {
    throw new Error(
      "[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Add both to your .env.local"
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The fixed user ID for this single-user FRIDAY instance.
 * Set FRIDAY_USER_ID in .env.local to any stable UUID (generate once with crypto.randomUUID()).
 */
export function getFridayUserId(): string {
  const id = process.env.FRIDAY_USER_ID;
  if (!id) {
    throw new Error(
      "[FRIDAY] FRIDAY_USER_ID is not set.\n" +
        "Run: node -e \"console.log(require('crypto').randomUUID())\" and add to .env.local"
    );
  }
  return id;
}
