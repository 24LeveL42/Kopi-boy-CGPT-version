-- ============================================================================
-- KOPI BOY 2.0 — Customer app: Web Push for order updates
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query >
-- paste this whole file > Run). Safe to re-run: IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS throughout. See docs/customer-push.md for the setup steps
-- (VAPID keys, Vercel env vars, the webhook URL) that go with it.
--
-- Run it AFTER docs/supabase-schema.sql (orders, delivery_requests) and after
-- the payment-proof migration that added orders.payment_proof_* (it works
-- without those columns, it just can't send "payment not received" until then).
--
-- What it reuses from the Partner app:
--   * pg_net, and the private.push_webhook_config row from the Partner's
--     docs/supabase-push-trigger.sql — the same shared secret, plus a new
--     `customer_url` column for this app's /api/push/order-update.
-- What it deliberately does NOT reuse:
--   * public.push_subscriptions. The Partner's webhook pushes every row
--     inserted into public.notifications (customer rows included, with the
--     kitchen name and PayNow number in the text) to every subscription in
--     that table. Customer devices in there would get every update twice, the
--     second time with personal details. So customers get their own table.
--   * The Partner's notifications trigger. The in-app inbox keeps working as
--     before; this file only adds the push on top.
-- ============================================================================

create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- 1. CUSTOMER PUSH SUBSCRIPTIONS (one per browser/device)
-- ----------------------------------------------------------------------------
create table if not exists public.customer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists customer_push_subscriptions_user_idx
  on public.customer_push_subscriptions (user_id);

alter table public.customer_push_subscriptions enable row level security;

-- Start from zero (Supabase auto-grants new public tables), then grant back
-- exactly insert / read / delete. No update: a changed subscription is a new row.
revoke all on public.customer_push_subscriptions from anon, authenticated;
grant select, insert, delete on public.customer_push_subscriptions to authenticated;
-- The /api/push/order-update sender reads these with the service-role key.
-- service_role skips RLS but not table grants.
grant select, delete on public.customer_push_subscriptions to service_role;

drop policy if exists "Customers can read their own push subscriptions" on public.customer_push_subscriptions;
create policy "Customers can read their own push subscriptions"
  on public.customer_push_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Customers can add their own push subscriptions" on public.customer_push_subscriptions;
create policy "Customers can add their own push subscriptions"
  on public.customer_push_subscriptions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Customers can delete their own push subscriptions" on public.customer_push_subscriptions;
create policy "Customers can delete their own push subscriptions"
  on public.customer_push_subscriptions for delete
  to authenticated
  using (auth.uid() = user_id);

-- A shared phone that switches account must hand its endpoint to the new
-- account; RLS alone can't express "take over this endpoint from someone
-- else", so the app saves through this (same pattern as the Partner's
-- register_push_subscription). It only ever writes the caller's own user_id.
create or replace function public.register_customer_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or p_p256dh = '' or p_auth = '' then
    raise exception 'invalid push subscription';
  end if;
  insert into public.customer_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

revoke all on function public.register_customer_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_customer_push_subscription(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. ONCE-ONLY LEDGER
-- The sender claims one row per change before pushing; a repeat delivery of
-- the same change hits the primary key and is dropped. Server-only: no access
-- for anon / authenticated at all.
-- ----------------------------------------------------------------------------
create table if not exists public.customer_push_log (
  dedupe_key text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  event text not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_push_log_order_idx on public.customer_push_log (order_id);

alter table public.customer_push_log enable row level security;
revoke all on public.customer_push_log from anon, authenticated;
grant select, insert on public.customer_push_log to service_role;

-- ----------------------------------------------------------------------------
-- 3. WEBHOOK CONFIG — reuse the Partner's row, add this app's URL
-- Identical to the Partner's docs/supabase-push-trigger.sql definition, so
-- this is a no-op where that already ran. Set the URL afterwards with the
-- UPDATE in docs/customer-push.md (no URL = no customer pushes, nothing breaks).
-- ----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.push_webhook_config (
  id boolean primary key default true check (id), -- exactly one row
  url text not null check (url like 'https://%' and url not like '%YOUR-DOMAIN%'),
  secret text not null check (secret <> 'PASTE_PUSH_WEBHOOK_SECRET_HERE' and length(secret) >= 16)
);
revoke all on table private.push_webhook_config from public, anon, authenticated;

alter table private.push_webhook_config
  add column if not exists customer_url text
  check (customer_url is null or (customer_url like 'https://%/api/push/order-update' and customer_url not like '%YOUR-%'));

-- ----------------------------------------------------------------------------
-- 4. SENDER
-- pg_net queues the request and sends it after the transaction commits, so it
-- never slows down or blocks the cook's / rider's write. Any failure is
-- downgraded to a WARNING: a push problem must never roll that write back.
-- The body carries only ids and the event name; the app looks up the rest.
-- ----------------------------------------------------------------------------
create or replace function private.send_customer_order_push(p_order_id uuid, p_event text, p_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
begin
  select customer_url, secret into cfg from private.push_webhook_config where customer_url is not null;
  if not found then
    return;
  end if;
  perform net.http_post(
    url := cfg.customer_url,
    body := jsonb_build_object('order_id', p_order_id, 'event', p_event, 'ref', p_ref),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', cfg.secret),
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'send_customer_order_push failed: %', sqlerrm;
end;
$$;

revoke all on function private.send_customer_order_push(uuid, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. TRIGGERS
-- Every branch is guarded by IS DISTINCT FROM, so re-saving an unchanged value
-- sends nothing; the ledger above stops any repeat delivery of the same change.
--
-- orders (real columns):
--   order_status -> 'accepted'                   order_accepted
--   order_status -> 'rejected' | 'cancelled'     order_cancelled
--   payment_status -> 'paid'                     payment_received
--   payment_proof_rejected_at -> a new value     payment_not_received
--     (only while still accepted + unpaid; ref = that timestamp, so a second
--     rejected proof is a new push but the same rejection is never sent twice)
-- delivery_requests (the rider lives here, not on orders):
--   status -> 'accepted'                         rider_on_the_way (ref = rider)
--   status -> 'completed'                        order_delivered
--   picked_up_at set                             order_picked_up (ref = rider)
--     ^ sent by the Partner app's own trigger (its docs/supabase-delivery-
--       pickup.sql) through send_customer_order_push above, not from here.
-- Nothing else sends a push.
--
-- payment_proof_rejected_at is read through to_jsonb(...) so this works (and
-- creates) even before the payment-proof migration has added the column.
-- ----------------------------------------------------------------------------
create or replace function private.customer_push_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_rejected text := to_jsonb(new) ->> 'payment_proof_rejected_at';
  v_old_rejected text := to_jsonb(old) ->> 'payment_proof_rejected_at';
begin
  if new.order_status is distinct from old.order_status then
    if new.order_status = 'accepted' then
      perform private.send_customer_order_push(new.id, 'order_accepted', null);
    elsif new.order_status in ('rejected', 'cancelled') then
      perform private.send_customer_order_push(new.id, 'order_cancelled', null);
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status and new.payment_status = 'paid' then
    perform private.send_customer_order_push(new.id, 'payment_received', null);
  end if;

  if v_new_rejected is not null
    and v_new_rejected is distinct from v_old_rejected
    and new.order_status = 'accepted'
    and new.payment_status <> 'paid' then
    perform private.send_customer_order_push(new.id, 'payment_not_received', v_new_rejected);
  end if;

  return null;
exception when others then
  raise warning 'customer_push_on_order_change failed: %', sqlerrm;
  return null;
end;
$$;

revoke all on function private.customer_push_on_order_change() from public, anon, authenticated;

-- No column list: payment_proof_rejected_at may not exist yet, and a column
-- list naming it would fail. The function returns at once for other changes.
drop trigger if exists customer_push_on_order_change on public.orders;
create trigger customer_push_on_order_change
  after update on public.orders
  for each row execute function private.customer_push_on_order_change();

create or replace function private.customer_push_on_delivery_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'accepted' then
    perform private.send_customer_order_push(new.order_id, 'rider_on_the_way', new.rider_id::text);
  elsif new.status = 'completed' then
    perform private.send_customer_order_push(new.order_id, 'order_delivered', null);
  end if;
  return null;
exception when others then
  raise warning 'customer_push_on_delivery_change failed: %', sqlerrm;
  return null;
end;
$$;

revoke all on function private.customer_push_on_delivery_change() from public, anon, authenticated;

drop trigger if exists customer_push_on_delivery_change on public.delivery_requests;
create trigger customer_push_on_delivery_change
  after insert or update of status on public.delivery_requests
  for each row execute function private.customer_push_on_delivery_change();

-- ----------------------------------------------------------------------------
-- HOW TO CHECK IT'S WORKING
-- After an order changes (e.g. a cook accepts a test order), run:
--
--   select id, status_code, left(content, 160) as response
--   from net._http_response order by created desc limit 5;
--
--   200 {"sent":1,...}       = pushed            200 {"duplicate":true} = repeat, dropped
--   200 {"subscriptions":0}  = customer hasn't turned notifications on
--   401 = secret doesn't match PUSH_WEBHOOK_SECRET in the Customer app's Vercel
--   503 = Customer app's Vercel env vars missing / not redeployed
-- ----------------------------------------------------------------------------
