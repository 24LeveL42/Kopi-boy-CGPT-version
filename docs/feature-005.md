# Feature #005 — Cart + Order Creation

## Scope

Customer browses a live kitchen's menu, adds items to a cart, and places an
order. No payment yet — that's Feature #006 (cook accept/reject + PayNow),
a separate step after this one. An order lands in Supabase with
`status = 'placed'` and nothing more.

Feature #004 (merchant profile + menu grid) was never actually built as its
own pass — `/merchant/[id]` was still a placeholder div. Since #005 needs a
menu to add items from, a minimal menu grid was added directly to that page
here rather than shipping a separate #004 first.

## What changed

| File | Change |
|---|---|
| `docs/supabase-schema.sql` | Appended `orders` + `order_items` tables (same migration as Partner/Boss repos). |
| `src/lib/types-order.ts` | New. `Cart`/`CartItem`/`Order`/`OrderItem` — kept in their own file per the existing convention in `types.ts`, not merged into the marketplace model. |
| `src/lib/cart-context.tsx` | New. `CartProvider`/`useCart()` — client-only cart state, persisted to `localStorage`. Single-kitchen cart: adding an item from a different kitchen than what's already in the cart prompts to clear it first. |
| `src/lib/order-actions.ts` | New. `placeOrder()` server action — re-fetches real `menu_items` prices and computes the subtotal itself rather than trusting the client's cart totals, then inserts `orders` + `order_items`. |
| `src/app/merchant/[id]/page.tsx` | Now also fetches and renders the kitchen's `menu_items`, each with an Add-to-cart control (`MenuItemRow`). |
| `src/components/MenuItemRow.tsx` | New. Add button / quantity stepper per menu item. |
| `src/components/CartButton.tsx` | Now reads cart count from `useCart()` instead of taking a `count` prop; links to `/cart`. |
| `src/app/cart/page.tsx` + `src/components/CartView.tsx` | New. Cart screen — quantity controls, subtotal, "Place order" (or a sign-in prompt if not authenticated). |
| `src/app/orders/[id]/page.tsx` | New. Order confirmation screen after checkout. |

## Known placeholders / decisions (intentional, not gaps to silently fix)

- **Single-kitchen cart.** Adding from a second kitchen clears the first via
  a confirm prompt. One cart always maps to exactly one order/one kitchen —
  simplest model given cooks fulfill independently.
- **`orders.status` is a single-value enum (`'placed'`)** on purpose. #006
  adds the accept/reject/PayNow state machine and the RLS update policies
  that let a cook move an order through it — don't widen this early.
- **No `delivery_fee` column** — that's #007 (delivery fee engine).
  `orders.subtotal` is the whole total until then.
- **`order_items.name`/`price` are snapshotted at order time**, not joined
  live from `menu_items`, since the Partner app's `KitchenSetupForm`
  replaces a kitchen's menu rows wholesale on every save — a later edit or
  deletion must never rewrite what a customer actually ordered and paid for.
- Cart is `localStorage`-only, no server-side "draft cart" concept — normal
  for a pre-checkout cart, but it does mean the cart doesn't follow a
  customer across devices.

## What's still NOT here

- Payment, cook accept/reject, any order status besides `placed` — #006.
- Any Partner/Boss UI for viewing orders. RLS policies on `orders`/
  `order_items` already let the kitchen owner and admins read the relevant
  rows, so that's just a UI to build later, not a schema change.
- Delivery fee / rider assignment — #007/#008.
- Order history list for the customer (the `BottomNav` "Orders" tab is
  still the disabled placeholder) — only the single order-confirmation
  screen exists so far.

## Open question for the Product Owner

None blocking. Worth deciding before #006: should a customer be able to
cancel a `'placed'` order before a cook accepts it? Nothing here prevents
adding a `cancelled` status + a customer-side update policy later, but it
wasn't asked for in this feature's scope.
