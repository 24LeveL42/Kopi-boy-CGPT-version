"use server";

import { createClient } from "@/lib/supabase/server";
import { haversineDistanceKm, estimateDeliveryFee } from "@/lib/distance";

/**
 * Places an order from the client's cart. Re-fetches real menu_items prices
 * and computes the subtotal itself here — never trust a client-supplied
 * price or total, since this is called directly from client cart state.
 * delivery_fee_estimate gets the same treatment: it's recomputed here from
 * the kitchen's own latitude/longitude and the customer-supplied coordinates
 * (just a location, not a price — but centralizing the formula here avoids
 * any client/server mismatch), never taken as a number from the client.
 *
 * `location` is optional and one-time — captured client-side via
 * navigator.geolocation (see src/lib/use-customer-location.ts), not a live
 * profile field. Declining it (or an unsupported browser) never blocks
 * placing an order; it just leaves customer_lat/lng and
 * delivery_fee_estimate null.
 *
 * Returns the new order id rather than calling redirect() itself: this is
 * invoked from inside a client-side try/catch (to surface errors on the
 * button), and redirect() throws internally, which a wrapping catch would
 * swallow as a failure. The caller navigates after a successful return.
 */
export async function placeOrder(
  kitchenId: string,
  items: { menuItemId: string; quantity: number }[],
  location?: { latitude: number; longitude: number } | null
): Promise<{ orderId: string }> {
  if (items.length === 0) throw new Error("Your cart is empty.");
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Invalid item quantity in cart.");
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in to place an order.");

  const { data: kitchen } = await supabase
    .from("kitchens")
    .select("id, is_live, latitude, longitude")
    .eq("id", kitchenId)
    .maybeSingle();
  if (!kitchen || !kitchen.is_live) throw new Error("This kitchen isn't accepting orders right now.");

  const deliveryFeeEstimate =
    location && kitchen.latitude != null && kitchen.longitude != null
      ? estimateDeliveryFee(
          haversineDistanceKm(location.latitude, location.longitude, kitchen.latitude, kitchen.longitude)
        )
      : null;

  const { data: menuItems, error: menuError } = await supabase
    .from("menu_items")
    .select("id, name, price")
    .eq("kitchen_id", kitchenId)
    .in(
      "id",
      items.map((i) => i.menuItemId)
    );
  if (menuError) throw new Error(`Couldn't load menu: ${menuError.message}`);

  const menuById = new Map((menuItems ?? []).map((m) => [m.id, m]));
  const orderItems = items.map((i) => {
    const menuItem = menuById.get(i.menuItemId);
    if (!menuItem) throw new Error("One of the items in your cart is no longer available.");
    return { menu_item_id: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: i.quantity };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: user.id,
      kitchen_id: kitchenId,
      subtotal,
      customer_lat: location?.latitude ?? null,
      customer_lng: location?.longitude ?? null,
      delivery_fee_estimate: deliveryFeeEstimate,
    })
    .select("id")
    .single();
  if (orderError) throw new Error(`Couldn't place order: ${orderError.message}`);

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems.map((i) => ({ ...i, order_id: order.id })));
  if (itemsError) throw new Error(`Couldn't save order items: ${itemsError.message}`);

  return { orderId: order.id };
}

export type CancelOrderResult = { ok: true } | { ok: false; message: string };

/**
 * Cancels a customer's own order — only while it's still `placed`. The
 * `.eq("order_status", "placed")` guard is the same "app's update call
 * includes the expected current state in its WHERE clause" pattern used for
 * every other order/request transition in this codebase (see CookOrdersPanel
 * in the Partner app): if the kitchen has already accepted/rejected it by
 * the time this runs, the update matches 0 rows instead of racing the cook's
 * decision. RLS (customer owns the order + order_status = 'placed') enforces
 * the same rule server-side.
 *
 * Returns a result object rather than throwing for these expected outcomes.
 * Next.js redacts a thrown Error's message from a Server Action in
 * production (replaced with a generic "Minified React error" digest, to
 * avoid leaking server internals) — a caller's try/catch still fires, but
 * `error.message` is useless for anything meant to be shown to the
 * customer. A returned string has no such restriction.
 */
export async function cancelOrder(orderId: string): Promise<CancelOrderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to cancel this order." };

  const { data, error } = await supabase
    .from("orders")
    .update({ order_status: "cancelled", decided_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("order_status", "placed")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: `Couldn't cancel order: ${error.message}` };
  if (!data) return { ok: false, message: "This order can no longer be cancelled — the kitchen has already responded." };
  return { ok: true };
}

export type RateOrderResult = { ok: true } | { ok: false; message: string };

/**
 * Rates a delivered order 1-5 stars, once. kitchen_id is read from the order
 * itself, never taken from the client. RLS (schema section 31,
 * order_ratable()) is what actually enforces "own order, delivered, not yet
 * rated" — the unique order_id turns a second attempt into error 23505.
 * Returns a result object rather than throwing, for the same reason as
 * cancelOrder() above.
 */
export async function rateOrder(orderId: string, stars: number): Promise<RateOrderResult> {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, message: "Pick between 1 and 5 stars." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to rate this order." };

  const { data: order } = await supabase.from("orders").select("kitchen_id").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, message: "Order not found." };

  const { error } = await supabase
    .from("ratings")
    .insert({ order_id: orderId, customer_id: user.id, kitchen_id: order.kitchen_id, stars });
  if (error?.code === "23505") return { ok: false, message: "You've already rated this order." };
  if (error) return { ok: false, message: "Couldn't save your rating — ratings open once the order is delivered." };
  return { ok: true };
}
