"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { quoteDeliveryForPostalCode } from "@/lib/delivery-quote";
import { deliveryQuoteMessage, isDeliveryType, type DeliveryType } from "@/lib/delivery-types";
import { getKitchenOrderStatus } from "@/lib/kitchens";
import { UNAVAILABLE_ORDER_MESSAGE } from "@/lib/kitchen-availability";
import { canAddAddress, isAddressId, validateAddressDetails, validateAddressInput } from "@/lib/addresses";
import { validateScheduledFor } from "@/lib/delivery-time";
import { isUuid } from "@/lib/order-push";
import {
  hasOptions,
  hasValidOptionIds,
  parsePricingChange,
  toRpcItems,
  type CartLineInput,
  type ExpectedPricing,
  type PricingChange,
} from "@/lib/order-pricing";

export type PlaceOrderResult =
  | { ok: true; orderId: string; addressSaved?: boolean }
  | { ok: false; message: string; pricingChanged?: PricingChange };

/**
 * `requestId`: a fresh UUID per checkout attempt, sent again on a retry of
 * the same attempt, so a double tap or a lost response never makes a second
 * order (place_order returns the existing one). `expected`: the food total
 * and delivery fee the customer was shown; if the database would charge
 * anything else, nothing is placed and `pricingChanged` carries the new
 * numbers for the customer to confirm.
 */
export interface PlaceOrderOptions {
  requestId?: string | null;
  expected?: ExpectedPricing | null;
}

/**
 * Where the order goes: one of the customer's saved addresses (`addressId`),
 * or a new address (`postalCode` + optional unit/notes, optionally saved).
 * Nothing else is read — coordinates, fees or address text a caller adds
 * are ignored. `scheduledFor` is an ISO time from the checkout's slot list,
 * or empty for As soon as possible — re-checked here against the server clock.
 */
export interface OrderDelivery {
  deliveryType: DeliveryType;
  scheduledFor?: string | null;
  addressId?: string | null;
  postalCode?: string;
  unit?: string | null;
  notes?: string | null;
  saveAddress?: boolean;
  saveLabel?: string;
}

const SAVED_ADDRESS_MISSING = "That saved address couldn't be found. Please choose another one.";
const SCHEDULING_UNAVAILABLE = "Scheduled delivery isn't available yet. Please choose As soon as possible.";

const MAX_ITEM_QUANTITY = 99;

// PGRST204 / 42703: the orders.delivery_address_* columns don't exist yet
// (docs/supabase-customer-addresses.sql not run).
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

const ADDON_UNAVAILABLE = "One of your add-ons is no longer available. Please check your choices.";
/** The old insert path can't price or record add-ons, so it refuses them. */
const ADDONS_NOT_LIVE = "Add-ons aren't available yet. Please remove them and try again.";

// What place_order raises, worded for the customer. Matched by name in the
// error message, like the quote_delivery errors in src/lib/delivery-quote.ts.
const PLACE_ORDER_ERRORS: [string, string][] = [
  ["kitchen_blocked", UNAVAILABLE_ORDER_MESSAGE],
  ["kitchen_unavailable", "This kitchen isn't accepting orders right now."],
  ["item_unavailable", "One of the items in your cart is no longer available."],
  ["invalid_item", "One of the items in your cart is no longer available."],
  ["invalid_quantity", "Invalid item quantity in cart."],
  ["empty_cart", "Your cart is empty."],
  ["kitchen_location_missing", deliveryQuoteMessage("kitchen_location_missing")],
  ["invalid_location", deliveryQuoteMessage("invalid_location")],
  ["invalid_schedule", "That delivery time has passed. Please choose another one."],
  // Add-ons (docs/supabase-addons.sql).
  ["option_sold_out", "One of the add-ons you picked has just sold out. Please check your choices."],
  ["option_required_missing", "Please make a choice for every required option."],
  ["option_too_many", "You've picked too many options for one of your dishes."],
  ["option_not_for_item", ADDON_UNAVAILABLE],
  ["invalid_option", ADDON_UNAVAILABLE],
  ["order_too_large", "This order is too large. Please split it into smaller orders."],
];

const PRICING_CHANGED_MESSAGE = "The price of your order has changed. Please check the new total.";

function expectedPricing(expected: ExpectedPricing | null | undefined): { food_total: number; delivery_fee: number } | null {
  if (!expected) return null;
  const foodTotal = Number(expected.foodTotal);
  const deliveryFee = Number(expected.deliveryFee);
  if (!Number.isFinite(foodTotal) || !Number.isFinite(deliveryFee)) return null;
  return { food_total: foodTotal, delivery_fee: deliveryFee };
}

/**
 * The order through public.place_order (docs/supabase-promotions.sql), which
 * prices it from menu_items with the kitchen's deal, takes the fee from
 * quote_delivery and creates order + items in one transaction. Runs with the
 * service role because only it may call the function; the customer id is
 * the signed-in user's, read on the server. Null means "not available":
 * no service-role key configured, or the function doesn't exist yet
 * (PGRST202) — the caller then places the order the old way.
 */
async function placeOrderThroughRpc(args: {
  customerId: string;
  kitchenId: string;
  items: CartLineInput[];
  delivery: Record<string, unknown>;
  options: PlaceOrderOptions | undefined;
}): Promise<PlaceOrderResult | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.rpc("place_order", {
    p_customer_id: args.customerId,
    p_kitchen_id: args.kitchenId,
    p_items: toRpcItems(args.items),
    p_delivery: args.delivery,
    p_expected: expectedPricing(args.options?.expected),
    p_request_id: isUuid(args.options?.requestId) ? args.options.requestId : null,
  });
  if (error?.code === "PGRST202") return null;
  if (error) {
    if (error.message.includes("pricing_changed")) {
      const change = parsePricingChange(error.details);
      return change ? { ok: false, message: PRICING_CHANGED_MESSAGE, pricingChanged: change } : { ok: false, message: PRICING_CHANGED_MESSAGE };
    }
    const known = PLACE_ORDER_ERRORS.find(([name]) => error.message.includes(name));
    return { ok: false, message: known ? known[1] : `Couldn't place order: ${error.message}` };
  }
  const orderId = (data as { order_id?: unknown } | null)?.order_id;
  if (typeof orderId !== "string" || !orderId) return { ok: false, message: "Couldn't place order: unknown error" };
  return { ok: true, orderId };
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
 * Once docs/supabase-promotions.sql PART 2 has run, the order itself is
 * created by the place_order database function (see placeOrderThroughRpc):
 * it prices every item from menu_items, applies the kitchen's best running
 * deal and calls quote_delivery again with the coordinates geocoded here.
 * Until then (or without the service-role key) the order is inserted the old
 * way below, unchanged.
 *
 * Add-ons (docs/supabase-addons.sql): a line may carry optionIds, the
 * add-ons picked for each unit. Only their ids go to place_order, which
 * prices and checks them from the database. The old insert path can't, so a
 * cart with add-ons is refused there instead of placed without them.
 *
 * Returns a result object rather than throwing, for the same reason as
 * cancelOrder() below (thrown messages are redacted in production), and
 * returns the new order id rather than calling redirect() itself — the
 * caller navigates after a successful return.
 */
export async function placeOrder(
  kitchenId: string,
  items: CartLineInput[],
  delivery: OrderDelivery,
  options?: PlaceOrderOptions
): Promise<PlaceOrderResult> {
  if (items.length === 0) return { ok: false, message: "Your cart is empty." };
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > MAX_ITEM_QUANTITY) {
      return { ok: false, message: "Invalid item quantity in cart." };
    }
    if (!hasValidOptionIds(item)) return { ok: false, message: ADDON_UNAVAILABLE };
  }
  if (!isDeliveryType(delivery?.deliveryType)) return { ok: false, message: "Choose Normal or Express delivery." };
  const schedule = validateScheduledFor(delivery.scheduledFor, new Date());
  if (!schedule.ok) return schedule;

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

  // "Save this address" runs after the order exists and never fails it.
  const finish = async (orderId: string): Promise<PlaceOrderResult> => {
    if (!savedAddress && delivery.saveAddress) {
      const addressSaved = await saveNewAddress(supabase, user.id, postalCode, quote, newDetails, delivery.saveLabel);
      return { ok: true, orderId, addressSaved };
    }
    return { ok: true, orderId };
  };

  const placed = await placeOrderThroughRpc({
    customerId: user.id,
    kitchenId,
    items,
    delivery: {
      delivery_type: delivery.deliveryType,
      lat: quote.lat,
      lng: quote.lng,
      postal_code: postalCode,
      scheduled_for: schedule.scheduledFor ?? null,
      address_line: snapshot.delivery_address_line,
      unit: snapshot.delivery_unit,
      notes: snapshot.delivery_notes,
    },
    options,
  });
  if (placed) return placed.ok ? finish(placed.orderId) : placed;

  // Below is the pre-place_order insert, which knows nothing about add-ons:
  // placing a line with picks here would drop them (and their price).
  if (items.some(hasOptions)) return { ok: false, message: ADDONS_NOT_LIVE };

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
    // Left out for As soon as possible, so the column's default (null) applies.
    ...(schedule.scheduledFor ? { scheduled_for: schedule.scheduledFor } : {}),
  };
  const insertOrder = (row: object) => supabase.from("orders").insert(row).select("id").single();
  let { data: order, error: orderError } = await insertOrder({ ...orderRow, ...snapshot });
  // Until the address migration runs, place the order as before (postal code only).
  if (isMissingColumn(orderError)) ({ data: order, error: orderError } = await insertOrder(orderRow));
  // Still missing a column with only the base row: orders.scheduled_for isn't there.
  if (isMissingColumn(orderError) && schedule.scheduledFor) return { ok: false, message: SCHEDULING_UNAVAILABLE };
  if (orderError || !order) return { ok: false, message: `Couldn't place order: ${orderError?.message ?? "unknown error"}` };

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems.map((i) => ({ ...i, order_id: order.id })));
  if (itemsError) return { ok: false, message: `Couldn't save order items: ${itemsError.message}` };

  return finish(order.id);
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

export type HideOrdersResult = { ok: true } | { ok: false; message: string };

const HIDE_ORDERS_UNAVAILABLE = "Removing orders isn't available yet — please try again later.";

/**
 * Removes one finished order from the customer's own order list — a hide,
 * not a delete: public.hide_my_order (docs/supabase-clear-orders.sql) only
 * stamps customer_archived_at, and kitchens/HQ keep the row. Runs with the
 * customer's own session so auth.uid() is them; the function itself checks
 * ownership and the finished-only rule. Until that SQL has run, PostgREST
 * answers PGRST202 and the customer gets HIDE_ORDERS_UNAVAILABLE.
 * Returns a result object rather than throwing, for the same reason as
 * cancelOrder() above.
 */
export async function hideMyOrder(orderId: string): Promise<HideOrdersResult> {
  if (!isUuid(orderId)) return { ok: false, message: "This order couldn't be found." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to manage your orders." };

  const { data, error } = await supabase.rpc("hide_my_order", { p_order_id: orderId });
  if (error?.code === "PGRST202") return { ok: false, message: HIDE_ORDERS_UNAVAILABLE };
  if (error) return { ok: false, message: "Couldn't remove this order — please try again." };
  if (data !== true) return { ok: false, message: "Only finished orders can be removed." };
  return { ok: true };
}

/**
 * Removes every finished order of the customer from their list, including
 * ones older than the 10 the list shows (public.hide_all_my_past_orders).
 * Orders still in progress stay. Zero hidden is still a success — the list
 * simply refreshes.
 */
export async function hideAllMyPastOrders(): Promise<HideOrdersResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in to manage your orders." };

  const { error } = await supabase.rpc("hide_all_my_past_orders");
  if (error?.code === "PGRST202") return { ok: false, message: HIDE_ORDERS_UNAVAILABLE };
  if (error) return { ok: false, message: "Couldn't clear your past orders — please try again." };
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
