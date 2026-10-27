"use server";

import { createClient } from "@/lib/supabase/server";
import { addOnErrorMessage, hasValidOptionIds, parseOrderPricing, toRpcItems, type CartLineInput, type CartQuote } from "@/lib/order-pricing";

/**
 * The cart's deal preview: the quote_order_pricing RPC prices the cart from
 * menu_items with the kitchen's best running deal, the same way place_order
 * will. Display only — placeOrder() never takes a price from here. Null on
 * any error, including the function not existing yet
 * (docs/supabase-promotions.sql PART 2 not run), and the cart then looks
 * exactly as it did before deals. Lines may carry add-on picks (optionIds);
 * a cart without any sends the same p_items as before add-ons existed.
 * An add-on the server refuses (sold out, removed, a new required group)
 * comes back as { addOnProblem }, worded for the customer.
 */
export async function quoteOrderPricing(kitchenId: string, items: CartLineInput[]): Promise<CartQuote> {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (!items.every(hasValidOptionIds)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_order_pricing", {
    p_kitchen_id: String(kitchenId ?? ""),
    p_items: toRpcItems(items),
  });
  if (error) {
    const addOnProblem = addOnErrorMessage(error.message);
    return addOnProblem ? { addOnProblem } : null;
  }
  return parseOrderPricing(data);
}
