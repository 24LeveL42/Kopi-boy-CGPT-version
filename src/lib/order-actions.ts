"use server";

import { createClient } from "@/lib/supabase/server";
import { quoteDeliveryForPostalCode } from "@/lib/delivery-quote";
import { deliveryQuoteMessage, isDeliveryType, type DeliveryType } from "@/lib/delivery-types";
import { getKitchenOrderStatus } from "@/lib/kitchens";
import { UNAVAILABLE_ORDER_MESSAGE } from "@/lib/kitchen-availability";
import { canAddAddress, isAddressId, validateAddressDetails, validateAddressInput } from "@/lib/addresses";

export type PlaceOrderResult =
  | { ok: true; orderId: string; addressSaved?: boolean }
  | { ok: false; message: string };

/**
 * Where the order goes: one of the customer's saved addresses (`addressId`),
 * or a new address (`postalCode` + optional unit/notes, optionally saved).
 * Nothing else is read — coordinates, fees or address text a caller adds
 * are ignored.
 */
export interface OrderDelivery {
  deliveryType: DeliveryType;
  addressId?: string | null;
  postalCode?: string;
  unit?: string | null;
  notes?: string | null;
  saveAddress?: boolean;
  saveLabel?: string;
}

const SAVED_ADDRESS_MISSING = "That saved address couldn't be found. Please choose another one.";

// PGRST204 / 42703: the orders.delivery_address_* columns don't exist yet
// (docs/supabase-customer-addresses.sql not run).
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

/**
 * Places an order from the client's cart. Re-fetches real menu_items prices
 * and computes the subtotal itself here — never trust a client-supplied
 * price or total, since this is called directly from client cart state.
 *
 * The delivery fee gets the same treatment: the client sends only which
 * saved address (by id) or which new postal code, and Normal/Express. A saved
 * address is read from the database, scoped to the signed-in customer, and
 * its postal code is geocoded again here rather than trusting its stored
 * coordinates. Then the quote_delivery RPC (src/lib/delivery-quote.ts) gives
 * distance and fee — no fee or coordinates are ever taken from the client.
 * If the fee can't be worked out (lookup down, kitchen has no location yet,
 * unknown postal code) no order is created. Nor is one created for a kitchen
 * HQ has blocked — checked here against the database, not the client's cart.
 *
 * The address text (line, unit, notes) is snapshotted onto the order, so a
 * later edit or delete of the saved address never changes this order.
 *
 * Returns a result object rather than throwing, for the same reason as
 * cancelOrder() below (thrown messages are redacted in production), and
 * returns the new order id rather than calling redirect() itself — the
 * caller navigates after a successful return.
 */
export async function placeOrder(
  kitchenId: string,
  items: { menuItemId: string; quantity: number }[],
  delivery: OrderDelivery
): Promise<PlaceOrderResult> {
  if (items.length === 0) return { ok: false, message: "Your cart is empty." };
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, message: "Invalid item quantity in cart." };
    }
  }
  if (!isDeliveryType(delivery?.deliveryType)) return { ok: false, message: "Choose Normal or Express delivery." };

  const savedAddressId = delivery.addressId ?? null;
  let postalCode = "";
  let newDetails: { unit: string | null; notes: string | null } = { unit: null, notes: null };
  if (savedAddressId != null) {
    if (!isAddressId(savedAddressId)) return { ok: false, message: SAVED_ADDRESS_MISSING };
  } else {
    postalCode = String(delivery.postalCode ?? "").trim();
    if (!/^\d{6}$/.test(postalCode)) return { ok: false, message: "Enter a 6-digit delivery postal code." };
    const details = validateAddressDetails(delivery.unit, delivery.notes);
    if (!details.ok) return details;
    newDetails = details;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to place an order." };

  const kitchenStatus = await getKitchenOrderStatus(supabase, kitchenId);
  if (kitchenStatus === "blocked") return { ok: false, message: UNAVAILABLE_ORDER_MESSAGE };
  if (kitchenStatus !== "open") return { ok: false, message: "This kitchen isn't accepting orders right now." };

  let savedAddress: { postal_code: string; address_line: string; unit: string | null; notes: string | null } | null = null;
  if (savedAddressId != null) {
    const { data } = await supabase
      .from("customer_addresses")
      .select("postal_code, address_line, unit, notes")
      .eq("id", savedAddressId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) return { ok: false, message: SAVED_ADDRESS_MISSING };
    savedAddress = data;
    postalCode = data.postal_code;
  }

  const quote = await quoteDeliveryForPostalCode(supabase, kitchenId, postalCode, delivery.deliveryType);
  if (!quote.ok) return { ok: false, message: deliveryQuoteMessage(quote.reason) };

  const snapshot = savedAddress
    ? { delivery_address_line: savedAddress.address_line, delivery_unit: savedAddress.unit, delivery_notes: savedAddress.notes }
    : { delivery_address_line: quote.address, delivery_unit: newDetails.unit, delivery_notes: newDetails.notes };

  const { data: menuItems, error: menuError } = await supabase
    .from("menu_items")
    .select("id, name, price")
    .eq("kitchen_id", kitchenId)
    .in(
      "id",
      items.map((i) => i.menuItemId)
    );
  if (menuError) return { ok: false, message: `Couldn't load menu: ${menuError.message}` };

  const menuById = new Map((menuItems ?? []).map((m) => [m.id, m]));
  const orderItems = [];
  for (const i of items) {
    const menuItem = menuById.get(i.menuItemId);
    if (!menuItem) return { ok: false, message: "One of the items in your cart is no longer available." };
    orderItems.push({ menu_item_id: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: i.quantity });
  }

  const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const orderRow = {
    customer_id: user.id,
    kitchen_id: kitchenId,
    subtotal,
    customer_postal_code: postalCode,
    customer_lat: quote.lat,
    customer_lng: quote.lng,
    delivery_type: delivery.deliveryType,
    delivery_distance_km: quote.distanceKm,
    delivery_fee_estimate: quote.fee,
  };
  const insertOrder = (row: object) => supabase.from("orders").insert(row).select("id").single();
  let { data: order, error: orderError } = await insertOrder({ ...orderRow, ...snapshot });
  // Until the address migration runs, place the order as before (postal code only).
  if (isMissingColumn(orderError)) ({ data: order, error: orderError } = await insertOrder(orderRow));
  if (orderError || !order) return { ok: false, message: `Couldn't place order: ${orderError?.message ?? "unknown error"}` };

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems.map((i) => ({ ...i, order_id: order.id })));
  if (itemsError) return { ok: false, message: `Couldn't save order items: ${itemsError.message}` };

  if (!savedAddress && delivery.saveAddress) {
    const addressSaved = await saveNewAddress(supabase, user.id, postalCode, quote, newDetails, delivery.saveLabel);
    return { ok: true, orderId: order.id, addressSaved };
  }
  return { ok: true, orderId: order.id };
}

/**
 * "Save this address" at checkout, after the order exists. Uses the geocoded
 * address and coordinates from the quote just made. Never fails the order:
 * a full address book (5) or any error just means it isn't saved.
 */
async function saveNewAddress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  postalCode: string,
  quote: { address: string; lat: number; lng: number },
  details: { unit: string | null; notes: string | null },
  label: string | undefined
): Promise<boolean> {
  const { count, error: countError } = await supabase
    .from("customer_addresses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError || !canAddAddress(count ?? 0)) return false;

  const valid = validateAddressInput({ label: label || "Home", postalCode, ...details });
  if (!valid.ok) return false;
  const { error } = await supabase.from("customer_addresses").insert({
    user_id: userId,
    label: valid.value.label,
    postal_code: postalCode,
    address_line: quote.address,
    unit: valid.value.unit,
    notes: valid.value.notes,
    lat: quote.lat,
    lng: quote.lng,
    is_default: (count ?? 0) === 0,
  });
  return !error;
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
