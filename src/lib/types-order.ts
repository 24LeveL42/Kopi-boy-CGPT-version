/**
 * Cart + order types — Feature #005 scope.
 *
 * Cart is client-only, kept in localStorage via CartProvider. Order/
 * OrderItem mirror the `orders`/`order_items` tables (docs/supabase-schema.sql).
 * status is a single-value union on purpose — #006 adds the rest of the
 * state machine (accepted/rejected/etc.), don't widen it early.
 */

export interface CartItem {
  menuItemId: string;
  name: string;
  price: number; // SGD, snapshotted from the menu item when added
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
