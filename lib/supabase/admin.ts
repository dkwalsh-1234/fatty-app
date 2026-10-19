import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../config";
import { serviceKey } from "../server-env";

let client: SupabaseClient | undefined;

/** Service-role client. Bypasses RLS: only use inside server routes after checking who's asking. */
export function admin(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
