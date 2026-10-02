# Order chat (customer ↔ rider)

A chat box on `/orders/[id]` between the customer and their assigned rider,
live via Supabase Realtime — same pattern as [notifications](notifications.md).

**Visibility window:** the chat box appears once a rider accepts the delivery
(`delivery_requests.status = 'accepted'`) and disappears again once the order
is delivered, cancelled, or rejected. It never appears before a rider is
assigned. This matches exactly what the database's RLS enforces (below), so
the box vanishes from the UI at the same moment the database would start
rejecting reads/writes for it.

## The table is owned by the Partner app

`public.messages` is created and owned by the Partner app's
`docs/supabase-messages.sql` — **this repo does not duplicate that script.**
Its columns: `id`, `order_id`, `sender_id` (a `profiles.id` — either the
order's customer or its assigned rider), `body` (1–2000 chars), `created_at`.
There is no `read_at` / delivery receipt.

Access control is entirely in that one script:

- `public.order_chat_participant(order_id)` (`SECURITY DEFINER`) returns true
  only when the order isn't cancelled/rejected, its delivery is `accepted`,
  and the caller is either `orders.customer_id` or `delivery_requests.rider_id`.
- RLS: `SELECT` and `INSERT` both require `order_chat_participant(order_id)`;
  `INSERT` additionally requires `sender_id = auth.uid()` (no impersonating
  the other party). No `UPDATE`/`DELETE` policy exists — messages are
  immutable once sent.
- Grants: `authenticated` gets `SELECT, INSERT` only. `anon` has nothing.
- `messages` is added to the `supabase_realtime` publication.

If that script hasn't been run yet on this Supabase project, the chat box's
fetch/subscribe will simply return nothing (or error) for every order — it
degrades the same way a missing `get_order_rider()` degrades the rider card.

## How it's wired (this app)

- `src/lib/messages.ts` — `MessageRow` type + pure helpers (`mergeMessages`,
  `normalizeMessageBody`).
- `src/components/OrderChat.tsx` — subscribes to `postgres_changes` INSERT on
  `messages` filtered to `order_id`, then fetches the latest messages on
  `SUBSCRIBED` (falls back to a fetch-only load on `CHANNEL_ERROR`/
  `TIMED_OUT`, same as `NotificationsProvider`). Sending is a plain
  `insert()` — the sent message reaches the sender's own screen the same way
  it reaches the other party's, via the Realtime echo, so there's no
  optimistic local insert to reconcile.
- `src/app/orders/[id]/page.tsx` — computes `chatVisible` from `order_status`
  and the active `delivery_requests` row and only mounts `<OrderChat>` while
  true, which also tears down its Realtime channel the instant the order is
  delivered/cancelled.

## Live verification checklist

1. **Grants/RLS** — in the Supabase SQL Editor:
   ```sql
   select grantee, privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'messages'
     and grantee in ('anon', 'authenticated');
   -- expect: authenticated / SELECT, authenticated / INSERT — nothing for anon

   select tablename from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages';
   -- expect: messages

   select proname, prosecdef from pg_proc where proname = 'order_chat_participant';
   -- expect: prosecdef = true (SECURITY DEFINER)
   ```
2. **Chat appears only when a rider is assigned** — open `/orders/<id>` for a
   `placed`/`accepted`/`ready` order with no accepted delivery: no chat box.
   In the SQL Editor, accept a delivery for it:
   ```sql
   update public.delivery_requests set status = 'accepted', accepted_at = now()
   where order_id = '<order id>';
   ```
   The chat box should appear within about a second (no reload — the page
   refreshes via `OrderRealtimeRefresher`).
3. **Live delivery, both directions** — with the customer's `/orders/<id>`
   open, insert a message as the rider:
   ```sql
   insert into public.messages (order_id, sender_id, body)
   values ('<order id>', '<rider profile id>', 'On my way!');
   ```
   It should appear on the left within about a second, no reload. Then send a
   message from the customer's chat box; confirm it appears on the right
   (via the Realtime echo, not instantly-local) and a second row lands in
   `public.messages`.
4. **Isolation** — as a different signed-in customer, confirm `select * from
   messages where order_id = '<order id>'` (through the app, i.e. via
   supabase-js with that user's session, not the SQL Editor) returns nothing
   — RLS should reject it since they're not a participant.
5. **Chat closes on delivery** — mark the delivery completed:
   ```sql
   update public.delivery_requests set status = 'completed', completed_at = now()
   where order_id = '<order id>';
   ```
   The chat box should disappear within about a second. Confirm a message
   insert attempted after this (e.g. replaying step 3's SQL) is rejected by
   RLS — `order_chat_participant` now returns false since the delivery is no
   longer `accepted`.
6. **Cancelled order** — for an order with an accepted delivery, cancel the
   order (as the customer, before it's delivered isn't a normal flow, but a
   rejected/cancelled order should never show chat) and confirm no chat box
   appears even if a `delivery_requests` row was once `accepted`.
