import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { ADDRESS_LIMIT_MESSAGE, SAVED_ADDRESS_COLUMNS, sortAddresses, type SavedAddress } from "@/lib/addresses";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export const ADDRESSES_NOT_READY_MESSAGE = "Saved addresses aren't available yet. Please try again later.";

/**
 * True when customer_addresses doesn't exist yet (docs/supabase-customer-
 * addresses.sql not run): PostgREST answers PGRST205, Postgres 42P01.
 */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

/** Database error -> something a customer can read. */
export function addressErrorMessage(error: { code?: string; message?: string }): string {
  if (error.message?.includes("address_limit_reached")) return ADDRESS_LIMIT_MESSAGE;
  if (isMissingTable(error)) return ADDRESSES_NOT_READY_MESSAGE;
  return "Couldn't save your address. Please try again.";
}

/**
 * The signed-in customer's saved addresses, default first. RLS already limits
 * rows to the owner; the user_id filter just says so. A missing table (SQL not
 * run yet) reads as "no saved addresses" so checkout keeps working.
 */
export async function loadSavedAddresses(
  supabase: ServerSupabase,
  userId: string
): Promise<{ addresses: SavedAddress[]; failed: boolean }> {
  const { data, error } = await supabase
    .from("customer_addresses")
    .select(SAVED_ADDRESS_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .returns<SavedAddress[]>();
  if (error) return { addresses: [], failed: !isMissingTable(error) };
  return { addresses: sortAddresses(data ?? []), failed: false };
}
