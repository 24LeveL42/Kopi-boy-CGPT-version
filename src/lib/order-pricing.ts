/**
 * Order money with a kitchen deal (docs/supabase-promotions.sql, PART 2).
 * orders.subtotal stays the gross food total; discount_total is what the
 * kitchen's deal takes off, and food_total (subtotal - discount_total) is
 * what the customer pays for the food. Orders without a deal, and every
 * order placed before PART 2 ran, have no discount, so they read and show
 * exactly as before. Client-safe: no Supabase calls here.
 *
 * Add-ons (docs/supabase-addons.sql) are part of subtotal, but deals only
 * ever discount dish prices.
 */

import { isUuid } from "@/lib/order-push";

export interface OrderMoney {
  subtotal: number;
  /** Absent before PART 2 runs. */
  discount_total?: number | string | null;
  food_total?: number | string | null;
}

const finite = (v: unknown) => (v == null || v === "" ? NaN : Number(v));

/** The deal's discount on this order; 0 when there's none. */
export function orderDiscount(order: OrderMoney): number {
  const discount = finite(order.discount_total);
  return Number.isFinite(discount) && discount > 0 ? discount : 0;
}

/** What the customer pays for the food (before the delivery fee). */
export function orderFoodTotal(order: OrderMoney): number {
  const foodTotal = finite(order.food_total);
  return Number.isFinite(foodTotal) ? foodTotal : Number(order.subtotal) - orderDiscount(order);
}

/** The "Deal" line's amount, e.g. "-$1.50". */
export function formatDealAmount(discount: number): string {
  return `-$${discount.toFixed(2)}`;
}

/** Pricing from quote_order_pricing (the cart preview) or place_order. */
export interface OrderPricing {
  subtotal: number;
  discountTotal: number;
  foodTotal: number;
  promotionLabel: string | null;
  /**
   * Add-ons' share of subtotal (docs/supabase-addons.sql). Present only when
   * above 0, so a cart without add-ons parses exactly as before.
   */
  optionsSubtotal?: number;
}

/**
 * A cart line as placeOrder / quoteOrderPricing take it. optionIds: the
 * add-ons picked for each unit of the dish (docs/supabase-addons.sql); none
 * or [] = a plain dish.
 */
export interface CartLineInput {
  menuItemId: string;
  quantity: number;
  optionIds?: string[];
}

/** The same cap as normalize_order_items in docs/supabase-addons.sql. */
const MAX_OPTIONS_PER_LINE = 50;

/** optionIds is absent, or a list of distinct option UUIDs. */
export function hasValidOptionIds(item: Pick<CartLineInput, "optionIds">): boolean {
  const ids = item?.optionIds;
  if (ids === undefined || ids === null) return true;
  if (!Array.isArray(ids) || ids.length > MAX_OPTIONS_PER_LINE || !ids.every(isUuid)) return false;
  return new Set(ids.map((id) => id.toLowerCase())).size === ids.length;
}

export function hasOptions(item: Pick<CartLineInput, "optionIds">): boolean {
  return Array.isArray(item?.optionIds) && item.optionIds.length > 0;
}

/**
 * p_items for place_order and quote_order_pricing. Only ids and quantities —
 * never a price or name, even if the browser adds one. option_ids goes only
 * on lines that have picks, so a cart without add-ons sends exactly the shape
 * it always has (and works on a database without the add-ons SQL).
 */
export function toRpcItems(items: CartLineInput[]): { menu_item_id: string; quantity: number; option_ids?: string[] }[] {
  return items.map((i) => ({
    menu_item_id: String(i?.menuItemId ?? ""),
    quantity: i?.quantity,
    ...(hasOptions(i) ? { option_ids: i.optionIds!.map(String) } : {}),
  }));
}

/** place_order's pricing_changed: the numbers the order would be placed at now. */
export interface PricingChange extends OrderPricing {
  deliveryFee: number;
  total: number;
}

/** What the customer was shown at checkout; place_order refuses with pricing_changed if it differs. */
export interface ExpectedPricing {
  foodTotal: number;
  deliveryFee: number;
}

export function parseOrderPricing(raw: unknown): OrderPricing | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const subtotal = finite(row.subtotal);
  const discountTotal = finite(row.discount_total);
  const foodTotal = finite(row.food_total);
  if (![subtotal, discountTotal, foodTotal].every(Number.isFinite) || discountTotal < 0 || foodTotal < 0) return null;
  const label = typeof row.promotion_label === "string" && row.promotion_label.trim() ? row.promotion_label.trim() : null;
  const optionsSubtotal = finite(row.options_subtotal);
  return {
    subtotal,
    discountTotal,
    foodTotal,
    promotionLabel: label,
    ...(Number.isFinite(optionsSubtotal) && optionsSubtotal > 0 ? { optionsSubtotal } : {}),
  };
}

/** The checkout's confirm dialog when place_order answers pricing_changed. */
export function pricingChangedPrompt(change: PricingChange): string {
  const deal = change.discountTotal > 0 ? `\nDeal: ${formatDealAmount(change.discountTotal)}` : "";
  return `The price of your order has changed.\n\nNew total: $${change.total.toFixed(2)}${deal}\n\nPlace your order at this price?`;
}

/** Reads the JSON place_order puts in the pricing_changed error's DETAIL. */
export function parsePricingChange(details: string | null | undefined): PricingChange | null {
  if (!details) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(details);
  } catch {
    return null;
  }
  const pricing = parseOrderPricing(raw);
  const deliveryFee = finite((raw as Record<string, unknown>).delivery_fee);
  if (!pricing || !Number.isFinite(deliveryFee) || deliveryFee < 0) return null;
  return { ...pricing, deliveryFee, total: Math.round((pricing.foodTotal + deliveryFee) * 100) / 100 };
}
