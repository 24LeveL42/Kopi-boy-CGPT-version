"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client — use this in "use client" components.
 * Reads the public URL + publishable key from env (set in .env.local,
 * never committed to git).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
