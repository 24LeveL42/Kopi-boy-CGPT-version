"use server";

import { createClient } from "@/lib/supabase/server";
import { hasValidOptionIds, parseOrderPricing, toRpcItems, type CartLineInput, type OrderPricing } from "@/lib/order-pricing";

/**
 * The cart's deal preview: the quote_order_pricing RPC prices the cart from
 * menu_items with the kitchen's best running deal, the same way place_order
 * will. Display only — placeOrder() never takes a price from here. Null on
 * any error, including the function not existing yet
 * (docs/supabase-promotions.sql PART 2 not run), and the cart then looks
 * exactly as it did before deals. Lines may carry add-on picks (optionIds);
 * a cart without any sends the same p_items as before add-ons existed.
 */
export async function quoteOrderPricing(kitchenId: string, items: CartLineInput[]): Promise<OrderPricing | null> {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (!items.every(hasValidOptionIds)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_order_pricing", {
    p_kitchen_id: String(kitchenId ?? ""),
    p_items: toRpcItems(items),
  });
  if (error) return null;
  return parseOrderPricing(data);
}
