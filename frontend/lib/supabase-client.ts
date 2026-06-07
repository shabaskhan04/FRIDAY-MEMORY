import { createClient } from "@supabase/supabase-js";

/**
 * Browser-safe Supabase client (anon key only).
 *
 * The frontend uses this ONLY for:
 *  - Reading raw_ledgers and todo_tasks in the main dashboard
 *  - Real-time subscriptions (future)
 *
 * All writes and AI operations go through the DigitalOcean backend
 * via lib/api-client.ts — never through this client.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
