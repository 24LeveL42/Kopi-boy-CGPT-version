/**
 * Cart lines with add-ons (docs/supabase-addons.sql). Client-safe.
 *
 * A line is a dish plus the add-ons picked for each unit of it. The same dish
 * with the same picks is one line (quantity goes up); different picks are
 * separate lines — the same rule as normalize_order_items on the server.
 * Prices here are display only: the server prices every order from
 * menu_items / menu_options.
 */

import { isUuid } from "@/lib/order-push";
import type { CartLineInput } from "@/lib/order-pricing";
import type { Cart, CartItem, CartItemOption } from "@/lib/types-order";

/** The ids of a line's picks, lower-cased; [] for a plain dish. */
export function lineOptionIds(item: Pick<CartItem, "options">): string[] {
  return (item.options ?? []).map((o) => o.id.toLowerCase());
}

/** Identifies a line: dish id plus its sorted pick ids ("m1|" for a plain dish). */
export function lineKey(item: Pick<CartItem, "menuItemId" | "options">): string {
  return `${item.menuItemId}|${[...lineOptionIds(item)].sort().join(",")}`;
}

/** One unit of the line: dish price plus every picked add-on. */
export function unitPrice(item: Pick<CartItem, "price" | "options">): number {
  const options = (item.options ?? []).reduce((sum, o) => sum + o.price, 0);
  return Math.round((item.price + options) * 100) / 100;
}

/** "Hot · Extra egg (+$0.80)" — the picks as the cart shows them. */
export function describeOptions(options: readonly Pick<CartItemOption, "name" | "price">[] | undefined): string {
  return (options ?? []).map((o) => (o.price > 0 ? `${o.name} (+$${o.price.toFixed(2)})` : o.name)).join(" · ");
}

/**
 * What placeOrder / quoteOrderPricing get for a line. A plain dish gives
 * exactly { menuItemId, quantity }, as before add-ons existed.
 */
export function toLineInput(item: CartItem): CartLineInput {
  const optionIds = lineOptionIds(item);
  return optionIds.length > 0 ? { menuItemId: item.menuItemId, quantity: item.quantity, optionIds } : { menuItemId: item.menuItemId, quantity: item.quantity };
}

/**
 * One checkout attempt's identity: the same key reuses the same request id
 * (so a retry can't place a second order), and any change to the kitchen,
 * the lines (dish, quantity or picks) or the delivery starts a new one.
 */
export function checkoutAttemptKey(kitchenId: string, items: CartLineInput[], delivery: unknown): string {
  return JSON.stringify([kitchenId, items, delivery]);
}

const isText = (v: unknown): v is string => typeof v === "string";
const isMoney = (v: unknown, min: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min;

function readOption(raw: unknown): CartItemOption | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isUuid(o.id) || !isText(o.name) || !isText(o.groupName) || !isMoney(o.price, 0)) return null;
  return { id: o.id.toLowerCase(), groupName: o.groupName, name: o.name, price: o.price };
}

function readLine(raw: unknown): CartItem | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  if (!isText(i.menuItemId) || !i.menuItemId || !isText(i.name) || !isMoney(i.price, 0)) return null;
  if (typeof i.quantity !== "number" || !Number.isInteger(i.quantity) || i.quantity < 1) return null;
  const item: CartItem = { menuItemId: i.menuItemId, name: i.name, price: i.price, quantity: i.quantity };
  if (i.photoUrl === null || isText(i.photoUrl)) item.photoUrl = i.photoUrl;
  if (i.options !== undefined) {
    if (!Array.isArray(i.options)) return null;
    const options = i.options.map(readOption);
    if (options.some((o) => o === null)) return null;
    if (new Set(options.map((o) => o!.id)).size !== options.length) return null;
    if (options.length > 0) item.options = options as CartItemOption[];
  }
  return item;
}

/**
 * The cart saved in localStorage, checked line by line. Carts saved before
 * add-ons (no `options`) load unchanged as plain dishes; a line that doesn't
 * make sense is dropped rather than crashing the app, and lines that turn
 * out to be the same are merged. Null when nothing usable is left.
 */
export function readSavedCart(raw: unknown): Cart | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!isText(c.kitchenId) || !c.kitchenId || !isText(c.kitchenName) || !Array.isArray(c.items)) return null;
  const items: CartItem[] = [];
  for (const line of c.items.map(readLine)) {
    if (!line) continue;
    const same = items.find((i) => lineKey(i) === lineKey(line));
    if (same) same.quantity += line.quantity;
    else items.push(line);
  }
  return items.length > 0 ? { kitchenId: c.kitchenId, kitchenName: c.kitchenName, items } : null;
}
