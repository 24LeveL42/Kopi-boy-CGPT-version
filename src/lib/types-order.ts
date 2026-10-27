/**
 * Cart + order types — Feature #005 scope.
 *
 * Cart is client-only, kept in localStorage via CartProvider. Order/
 * OrderItem mirror the `orders`/`order_items` tables (docs/supabase-schema.sql).
 * status is a single-value union on purpose — #006 adds the rest of the
 * state machine (accepted/rejected/etc.), don't widen it early.
 */

/** An add-on picked for each unit of a cart line (docs/supabase-addons.sql). */
export interface CartItemOption {
  id: string;
  groupName: string;
  name: string;
  price: number; // SGD, display only — the server prices add-ons from menu_options
}

export interface CartItem {
  menuItemId: string;
  name: string;
  price: number; // SGD, snapshotted from the menu item when added
  /** Original menu photo, carried into the cart so the cart can show the real food image. */
  photoUrl?: string | null;
  /**
   * Add-ons picked for this line, in menu order. Absent (carts saved before
   * add-ons, and dishes without any) = a plain dish. The same dish with
   * different picks is a separate line — see lineKey().
   */
  options?: CartItemOption[];
  quantity: number;
}

export interface Cart {
  kitchenId: string;
  kitchenName: string;
  items: CartItem[];
}

export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  kitchenId: string;
  kitchenName: string;
  status: "placed";
  subtotal: number;
  createdAt: string;
}
