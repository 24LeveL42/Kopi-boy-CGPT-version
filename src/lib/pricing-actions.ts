"use server";

import { createClient } from "@/lib/supabase/server";
import { parseOrderPricing, type OrderPricing } from "@/lib/order-pricing";

/**
 * The cart's deal preview: the quote_order_pricing RPC prices the cart from
 * menu_items with the kitchen's best running deal, the same way place_order
 * will. Display only — placeOrder() never takes a price from here. Null on
 * any error, including the function not existing yet
 * (docs/supabase-promotions.sql PART 2 not run), and the cart then looks
 * exactly as it did before deals.
 */
export async function quoteOrderPricing(
  kitchenId: string,
  items: { menuItemId: string; quantity: number }[]
): Promise<OrderPricing | null> {
  if (!Array.isArray(items) || items.length === 0) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_order_pricing", {
    p_kitchen_id: String(kitchenId ?? ""),
    p_items: items.map((i) => ({ menu_item_id: String(i?.menuItemId ?? ""), quantity: i?.quantity })),
  });
  if (error) return null;
  return parseOrderPricing(data);
}
