import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

let _serviceClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client authenticated with the service role key.
 * Singleton — safe to call on every request.
 * Backend-only: never expose this client to the browser.
 */
export function createServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;

  const url = process.env.SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !serviceKey) {
    throw new Error(
      "[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Add both to your environment."
    );
  }

  _serviceClient = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _serviceClient;
}

/**
 * The fixed user ID for this single-user FRIDAY instance.
 */
export function getFridayUserId(): string {
  const id = process.env.FRIDAY_USER_ID;
  if (!id) {
    throw new Error(
      "[FRIDAY] FRIDAY_USER_ID is not set.\n" +
        'Run: node -e "console.log(require(\'crypto\').randomUUID())" and add to env.'
    );
  }
  return id;
}
