"use server";

import { createClient } from "@/lib/supabase/server";
import { getKitchenOrderStatus } from "@/lib/kitchens";

/**
 * Lets the cart warn before checkout when its kitchen has been blocked by HQ.
 * Display only — placeOrder() re-checks on its own. Returns just a yes/no,
 * never a reason.
 */
export async function isKitchenBlocked(kitchenId: string): Promise<boolean> {
  const supabase = await createClient();
  return (await getKitchenOrderStatus(supabase, String(kitchenId ?? ""))) === "blocked";
}
