-- ============================================================================
-- KOPI BOY 2.0 — Customer app: payment deadline + payment screenshot clean-up
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query >
-- paste this whole file > Run). Safe to re-run: IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS throughout, and the cron jobs are replaced by name.
--
-- Run it AFTER docs/supabase-schema.sql, docs/supabase-customer-push.sql and
-- the payment-proof migration (orders.payment_proof_*, the payment-proofs
-- bucket, public.submit_payment_proof).
--
-- PART 1 — unpaid orders are cancelled automatically:
--   * public.payment_window_minutes() is THE one place the time to pay lives.
--   * When the cook accepts, the database stamps orders.payment_due_at =
--     now() + that many minutes (database clock, never the browser's).
--   * Every minute, pg_cron cancels accepted + unpaid orders whose
--     payment_due_at has passed and that have no proof uploaded
--     (cancel_reason = 'not_paid_in_time'). The existing triggers on orders
--     send the customer's push / inbox entry and tell the cook.
--   * Once a proof is uploaded the order is never auto-cancelled again.
--   * Orders already waiting for payment when this file first runs have no
--     payment_due_at, so they are never auto-cancelled.
--
-- PART 2 — payment screenshots are deleted after 60 days:
--   * public.payment_proof_retention_days() is the one place for the 60.
--   * Supabase blocks deleting storage.objects rows in SQL, so once a day
--     pg_cron asks the Customer app's /api/cron/purge-payment-proofs (through
--     pg_net, with the push webhook's shared secret) to delete the files with
--     the Storage API. The route then clears orders.payment_proof_path and
--     stamps payment_proof_removed_at. The order row itself is kept.
--   * Set the route's URL afterwards with the UPDATE at the end of this file.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- 1. SETTINGS — change the numbers here and re-run just this function.
-- The app reads payment_window_minutes() for its wording ("within 5
-- minutes"); the countdown and the cancel job only use payment_due_at, which
-- is stamped from it at accept time. A change applies to orders accepted
-- after it; orders already waiting keep the deadline they were given.
-- ----------------------------------------------------------------------------
create or replace function public.payment_window_minutes()
returns integer
language sql
stable
set search_path = ''
as $$
  select 5;
$$;

grant execute on function public.payment_window_minutes() to anon, authenticated, service_role;

create or replace function public.payment_proof_retention_days()
returns integer
language sql
stable
set search_path = ''
as $$
  select 60;
$$;

revoke all on function public.payment_proof_retention_days() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. COLUMNS
-- payment_due_at          when the customer must have uploaded a proof by
-- cancel_reason           why the order was cancelled; only 'not_paid_in_time'
--                         for now (null = cancelled by a person)
-- payment_proof_removed_at when the screenshot was deleted after the retention
--                         period (payment_proof_path is cleared then)
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists payment_due_at timestamptz;
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists payment_proof_removed_at timestamptz;

alter table public.orders drop constraint if exists orders_cancel_reason_check;
alter table public.orders add constraint orders_cancel_reason_check
  check (cancel_reason is null or cancel_reason in ('not_paid_in_time'));

-- What the every-minute job scans: only orders still waiting for a proof.
create index if not exists orders_payment_due_idx
  on public.orders (payment_due_at)
  where order_status = 'accepted' and payment_status = 'unpaid' and payment_proof_uploaded_at is null;

-- ----------------------------------------------------------------------------
-- 3. STAMP THE DEADLINE — and keep clients' hands off these columns
-- `authenticated` has a table-wide UPDATE grant on orders (the cook's status
-- changes, the customer's cancel), so without this a cook could move a
-- deadline or a customer could write a cancel reason. Same pattern as
-- protect_customer_archived_at (schema section 27): the server-side writers
-- (this trigger, the cron job, the purge, SECURITY DEFINER RPCs) run as the
-- table owner, so current_user tells them apart.
-- ----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.orders_payment_timer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.payment_due_at := null;
      new.cancel_reason := null;
      new.payment_proof_removed_at := null;
    else
      new.payment_due_at := old.payment_due_at;
      new.cancel_reason := old.cancel_reason;
      new.payment_proof_removed_at := old.payment_proof_removed_at;
    end if;
  end if;

  if tg_op = 'UPDATE'
    and new.order_status = 'accepted'
    and old.order_status is distinct from 'accepted'
    and new.payment_status = 'unpaid' then
    new.payment_due_at := now() + make_interval(mins => public.payment_window_minutes());
  end if;

  return new;
end;
$$;

revoke all on function private.orders_payment_timer() from public, anon, authenticated;

drop trigger if exists orders_payment_timer on public.orders;
create trigger orders_payment_timer
  before insert or update on public.orders
  for each row execute function private.orders_payment_timer();

-- ----------------------------------------------------------------------------
-- 4. AUTO-CANCEL (pg_cron, every minute)
-- Race-safe: the UPDATE row-locks each order and re-checks the WHERE on the
-- latest version, and submit_payment_proof (section 5) locks the same row.
-- Whichever commits first wins: a proof that lands first means this skips
-- the order; a cancel that lands first means the upload is refused. Late by a
-- few seconds is fine — a proof is accepted until the order is actually
-- cancelled. Idempotent: a cancelled order no longer matches.
--
-- Only orders still waiting for a first proof: accepted, unpaid, nothing
-- prepared, no proof ever uploaded. Paid / preparing / delivered /
-- cancelled / rejected orders never match, nor do orders without a deadline.
--
-- A proof uploaded at any time stops this for good, including one the cook
-- later rejects (payment_proof_uploaded_at stays set; rejecting only stamps
-- payment_proof_rejected_at). Such an order is never auto-cancelled: it stays
-- accepted + unpaid, the customer can upload again at any time, and only a
-- person cancels it. The query under "ORDERS WAITING ON A REJECTED PROOF" at
-- the end of this file lists them.
--
-- The order_status change fires the existing triggers: the customer's push
-- (docs/supabase-customer-push.sql; the app words it from cancel_reason),
-- the customer's inbox entry and the cook's notification.
-- ----------------------------------------------------------------------------
create or replace function private.cancel_unpaid_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.orders o
  set order_status = 'cancelled',
      cancel_reason = 'not_paid_in_time',
      decided_at = now()
  where o.order_status = 'accepted'
    and o.payment_status = 'unpaid'
    and o.preparation_status = 'not_started'
    and o.payment_proof_uploaded_at is null
    and o.payment_proof_path is null
    and o.payment_due_at is not null
    and o.payment_due_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.cancel_unpaid_orders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kb-cancel-unpaid-orders';
select cron.schedule('kb-cancel-unpaid-orders', '* * * * *', 'select private.cancel_unpaid_orders()');

-- ----------------------------------------------------------------------------
-- 5. PROOF UPLOAD — row lock so a proof and the auto-cancel can't both win
-- Built from the live definition (pg_get_functiondef, 2026-10-19). Identical
-- except:
--   * the order row is locked first (SELECT ... FOR UPDATE), so this and
--     private.cancel_unpaid_orders() take turns on the same row: whichever
--     gets the lock first wins, the other sees its result;
--   * an order the job already cancelled gets its own message (the app shows
--     it as is, see src/components/PaymentProofCard.tsx) instead of the
--     generic one.
-- Late by a few seconds is fine: until the job has actually cancelled the
-- order it is still 'accepted', and the proof is accepted.
-- ----------------------------------------------------------------------------
create or replace function public.submit_payment_proof(p_order_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  select o.order_status, o.cancel_reason into v_order
  from public.orders o
  where o.id = p_order_id and o.customer_id = auth.uid()
  for update;

  if found and v_order.order_status = 'cancelled' and v_order.cancel_reason = 'not_paid_in_time' then
    raise exception 'This order was cancelled because payment wasn''t received in time';
  end if;

  update public.orders
  set payment_proof_path = p_path,
      payment_proof_uploaded_at = now(),
      payment_proof_rejected_at = null
  where id = p_order_id
    and customer_id = auth.uid()
    and order_status = 'accepted'
    and payment_status = 'unpaid'
    and p_path like p_order_id::text || '/' || auth.uid()::text || '/%';

  if not found then
    raise exception 'Cannot attach payment proof to this order';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. NOTIFICATION WORDING FOR AN UNPAID CANCEL
-- Both built from the live definitions (pg_get_functiondef, 2026-10-19) and
-- identical except for the one cancelled line, which now says why when
-- cancel_reason = 'not_paid_in_time'. Every other cancel keeps its old text.
-- CREATE OR REPLACE keeps each function's owner, grants and triggers.
--
-- public.notify_on_order_change() is the Partner app's (its
-- docs/supabase-notifications.sql): the cook's "Order cancelled" entry. If
-- that file is ever re-run it puts back "cancelled by the customer" for
-- every cancel; re-run this file afterwards.
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.notify_user(
        new.kitchen_id, 'orders', 'order_placed', 'New order',
        'Order #' || public.short_id(new.id) || ' · $' || to_char(new.subtotal, 'FM999990.00'),
        '/', new.id
      );

    elsif new.order_status = 'cancelled' and old.order_status is distinct from 'cancelled' then
      -- (only reached on UPDATE: the INSERT branch above already matched)
      perform public.notify_user(
        new.kitchen_id, 'orders', 'order_cancelled', 'Order cancelled',
        case
          when new.cancel_reason = 'not_paid_in_time'
            then 'Order #' || public.short_id(new.id) || ' was cancelled: the customer didn''t pay in time.'
          else 'Order #' || public.short_id(new.id) || ' was cancelled by the customer.'
        end,
        '/', new.id
      );
      -- A rider already on the way needs to know the food is no longer needed.
      for r in
        select id, rider_id from public.delivery_requests
        where order_id = new.id and status in ('accepted', 'release_requested') and rider_id is not null
      loop
        perform public.notify_user(
          r.rider_id, 'deliveries', 'delivery_cancelled', 'Delivery cancelled',
          'Order #' || public.short_id(new.id) || ' was cancelled — no need to collect it.',
          '/', r.id
        );
      end loop;
    end if;
  exception when others then
    raise warning 'notify_on_order_change failed: %', sqlerrm;
  end;
  return new;
end;
$$;

-- The customer's in-app inbox entry (this repo's docs/supabase-schema.sql
-- section 24; re-running that section puts back the plain line — re-run this
-- file afterwards).
create or replace function public.notify_customer_on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kitchen text;
  v_paynow_type text;
  v_paynow_value text;
  v_pay_hint text := '';
begin
  select k.business_name, k.paynow_type, k.paynow_value
    into v_kitchen, v_paynow_type, v_paynow_value
  from public.kitchens k
  where k.id = new.kitchen_id;
  v_kitchen := coalesce(v_kitchen, 'The kitchen');

  if tg_op = 'INSERT' then
    perform public.create_customer_notification(
      new.customer_id, new.id, 'order_placed', 'Order sent',
      v_kitchen || ' has received your order. Waiting for them to accept.'
    );
    return new;
  end if;

  if new.order_status is distinct from old.order_status then
    if new.order_status = 'accepted' then
      if new.payment_status <> 'paid' then
        v_pay_hint := case
          when v_paynow_value is null then ' Please pay the cook via PayNow.'
          when v_paynow_type = 'mobile' then ' Pay via PayNow to +65 ' || v_paynow_value || '.'
          else ' Pay via PayNow to UEN ' || v_paynow_value || '.'
        end;
      end if;
      perform public.create_customer_notification(
        new.customer_id, new.id, 'order_accepted', 'Order accepted',
        v_kitchen || ' accepted your order.' || v_pay_hint
      );
    elsif new.order_status = 'rejected' then
      perform public.create_customer_notification(
        new.customer_id, new.id, 'order_rejected', 'Order rejected',
        v_kitchen || ' couldn''t take your order. Try another kitchen.'
      );
    elsif new.order_status = 'cancelled' then
      perform public.create_customer_notification(
        new.customer_id, new.id, 'order_cancelled', 'Order cancelled',
        case
          when new.cancel_reason = 'not_paid_in_time'
            then 'Your order from ' || v_kitchen || ' was cancelled because your payment wasn''t received in time.'
          else 'Your order from ' || v_kitchen || ' was cancelled.'
        end
      );
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status and new.payment_status = 'paid' then
    perform public.create_customer_notification(
      new.customer_id, new.id, 'payment_received', 'Payment received',
      v_kitchen || ' confirmed your payment. Thank you!'
    );
  end if;

  if new.preparation_status is distinct from old.preparation_status and new.preparation_status = 'ready' then
    perform public.create_customer_notification(
      new.customer_id, new.id, 'order_ready', 'Food is ready',
      v_kitchen || ' has finished preparing your food. Looking for a rider.'
    );
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. SCREENSHOT CLEAN-UP (pg_cron, daily)
-- Server-only RPCs for /api/cron/purge-payment-proofs (service-role key):
--   expired_payment_proof_files  names of files older than the retention
--                                period, by the database clock — the route
--                                deletes only these. Includes replaced and
--                                rejected screenshots no order points to.
--   clear_removed_payment_proofs clears payment_proof_path on orders whose
--                                (old enough) file is gone, stamping
--                                payment_proof_removed_at. Idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.expired_payment_proof_files(p_limit integer default 100)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'payment-proofs'
    and o.created_at < now() - make_interval(days => public.payment_proof_retention_days())
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

revoke all on function public.expired_payment_proof_files(integer) from public, anon, authenticated;
grant execute on function public.expired_payment_proof_files(integer) to service_role;

create or replace function public.clear_removed_payment_proofs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.orders o
  set payment_proof_path = null,
      payment_proof_removed_at = now()
  where o.payment_proof_path is not null
    and o.payment_proof_uploaded_at < now() - make_interval(days => public.payment_proof_retention_days())
    and not exists (
      select 1 from storage.objects s
      where s.bucket_id = 'payment-proofs' and s.name = o.payment_proof_path
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.clear_removed_payment_proofs() from public, anon, authenticated;
grant execute on function public.clear_removed_payment_proofs() to service_role;

-- The route's URL lives next to the shared secret it is called with, in the
-- Partner's private.push_webhook_config row (see docs/supabase-customer-push.sql).
-- Rotating the secret stays a one-row change here (+ PUSH_WEBHOOK_SECRET in
-- each app's Vercel env, as today).
alter table private.push_webhook_config
  add column if not exists payment_proof_purge_url text
  check (
    payment_proof_purge_url is null
    or (payment_proof_purge_url like 'https://%/api/cron/purge-payment-proofs' and payment_proof_purge_url not like '%YOUR-%')
  );

create or replace function private.request_payment_proof_purge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
begin
  select payment_proof_purge_url, secret into cfg
  from private.push_webhook_config
  where payment_proof_purge_url is not null;
  if not found then
    raise warning 'request_payment_proof_purge: payment_proof_purge_url is not set';
    return;
  end if;
  perform net.http_post(
    url := cfg.payment_proof_purge_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', cfg.secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.request_payment_proof_purge() from public, anon, authenticated;

-- 19:30 UTC = 03:30 Singapore time.
select cron.unschedule(jobid) from cron.job where jobname = 'kb-purge-payment-proofs';
select cron.schedule('kb-purge-payment-proofs', '30 19 * * *', 'select private.request_payment_proof_purge()');

-- ----------------------------------------------------------------------------
-- AFTER RUNNING: set the purge route's URL (once; your Customer app domain):
--
--   update private.push_webhook_config
--   set payment_proof_purge_url = 'https://YOUR-CUSTOMER-APP/api/cron/purge-payment-proofs';
--
-- HOW TO CHECK IT'S WORKING
--   select jobname, schedule, active from cron.job where jobname like 'kb-%';
--   select j.jobname, d.status, d.return_message, d.start_time
--   from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname like 'kb-%' order by d.start_time desc limit 10;
--
--   Purge replies (net._http_response, newest first):
--   select status_code, left(content, 200) from net._http_response order by created desc limit 5;
--   200 {"deleted":3,"cleared":2,"more":false} = done   401 = secret mismatch
--   503 = Customer app's Vercel env vars missing
--
-- TRY THE 5-MINUTE RULE WITHOUT WAITING (a test order, accepted, no proof):
--   update public.orders set payment_due_at = now() - interval '1 minute'
--   where id = '<test order id>';
--   select private.cancel_unpaid_orders();   -- or wait up to a minute for cron
--   select order_status, cancel_reason from public.orders where id = '<test order id>';
--
-- ORDERS WAITING ON A REJECTED PROOF (never auto-cancelled; a person decides)
--   select id, kitchen_id, payment_proof_uploaded_at, payment_proof_rejected_at
--   from public.orders
--   where order_status = 'accepted' and payment_status = 'unpaid'
--     and payment_proof_rejected_at is not null
--     and payment_proof_rejected_at > payment_proof_uploaded_at
--   order by payment_proof_rejected_at;
--
--   To cancel one by hand (cancel_reason stays null, so the customer gets the
--   plain "Your order was cancelled." push and the cook is notified as usual):
--   update public.orders set order_status = 'cancelled', decided_at = now()
--   where id = '<order id>' and order_status = 'accepted' and payment_status = 'unpaid';
-- ----------------------------------------------------------------------------
