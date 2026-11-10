import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Never import this from a Client Component. The key is
 * server-only and bypasses RLS; Supabase is used exclusively for persistence.
 */
export function getDb(): SupabaseClient {
  if (client) return client;
  client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "cross-store-bridge" },
    },
  });
  return client;
}

export function resetDbForTests(): void {
  client = null;
}
