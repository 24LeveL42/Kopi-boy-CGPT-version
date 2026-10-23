/**
 * Order money with a kitchen deal (docs/supabase-promotions.sql, PART 2).
 * orders.subtotal stays the gross food total; discount_total is what the
 * kitchen's deal takes off, and food_total (subtotal - discount_total) is
 * what the customer pays for the food. Orders without a deal, and every
 * order placed before PART 2 ran, have no discount, so they read and show
 * exactly as before. Client-safe: no Supabase calls here.
 */

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
  return { subtotal, discountTotal, foodTotal, promotionLabel: label };
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
