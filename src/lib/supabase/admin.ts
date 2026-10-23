import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server actions that call functions only
 * the service role may run (public.place_order, docs/supabase-promotions.sql).
 * It bypasses RLS, so never pass it anything the server hasn't checked, and
 * never import this from client code — "server-only" makes that a build
 * error, and SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so the key
 * is never bundled for the browser.
 *
 * Null when the URL or key isn't configured (e.g. a local dev setup without
 * the key): callers fall back to what they did before.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
