-- ============================================================================
-- CLEAR PAST ORDERS — the customer hides finished orders from their own list
-- Customer app: "Remove" on a finished order card, "Clear all past orders"
-- under the list (src/app/orders/page.tsx, src/lib/order-actions.ts).
--
-- A HIDE, never a delete. Both functions only stamp customer_archived_at,
-- the same column the 10-order cap uses (schema section 27). The row stays
-- for the kitchen, the rider, HQ, complaint threads, ratings, accounting and
-- promotions (per_customer_limit counts orders by promotion_id). The order
-- still opens by direct link (schema section 28); only the list skips it.
--
-- Only FINISHED orders, the same "settled" rule as archive_old_customer_orders:
--   order_status in ('cancelled', 'rejected')
--   or a delivery_request for it is 'completed' (= Delivered; order_status
--      stays 'accepted' on a delivered order — there is no 'delivered' status)
-- Placed, awaiting payment, preparing, ready and rider-on-the-way orders are
-- never touched.
--
-- Why SECURITY DEFINER: protect_customer_archived_at (schema section 27) and
-- private.orders_client_guard (promotions section 2.8) put the column back
-- whenever current_user is anon/authenticated. Inside these functions
-- current_user is the owner, so the stamp sticks — the same way the archive
-- trigger's write does. auth.uid() is still the caller, so each function only
-- ever touches the caller's own orders. Neither ever clears the column, so
-- nothing can be un-hidden through them.
--
-- Side effects on the update: none of the order notification/push triggers
-- fire (they watch status columns only). orders_release_promotion may give a
-- cancelled/rejected order's deal back if the 10-minute sweeper hasn't yet —
-- once only, the same release that sweeper would do.
--
-- Deploy: AFTER the app. Until this runs, the app's buttons answer
-- "isn't available yet" (PGRST202). Safe to re-run.
-- Run in the Supabase SQL Editor, then: notify pgrst, 'reload schema';
-- ============================================================================

-- One order. True when it was hidden now; false when it isn't the caller's,
-- isn't finished, or is already hidden.
create or replace function public.hide_my_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  update public.orders o
  set customer_archived_at = now()
  where o.id = p_order_id
    and o.customer_id = v_uid
    and o.customer_archived_at is null
    and (
      o.order_status in ('cancelled', 'rejected')
      or exists (select 1 from public.delivery_requests d where d.order_id = o.id and d.status = 'completed')
    );

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.hide_my_order(uuid) from public, anon;
grant execute on function public.hide_my_order(uuid) to authenticated;

-- Every finished order of the caller, including ones older than the 10 the
-- list shows. Returns how many were hidden now.
create or replace function public.hide_all_my_past_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;

  update public.orders o
  set customer_archived_at = now()
  where o.customer_id = v_uid
    and o.customer_archived_at is null
    and (
      o.order_status in ('cancelled', 'rejected')
      or exists (select 1 from public.delivery_requests d where d.order_id = o.id and d.status = 'completed')
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.hide_all_my_past_orders() from public, anon;
grant execute on function public.hide_all_my_past_orders() to authenticated;

-- ----------------------------------------------------------------------------
-- CHECKS (read-only; run after the above)
-- ----------------------------------------------------------------------------
-- Both functions exist, are SECURITY DEFINER, and only authenticated (plus
-- the owner/service_role) may execute:
--   select p.proname, p.prosecdef, p.proconfig,
--          has_function_privilege('anon', p.oid, 'execute') as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in ('hide_my_order', 'hide_all_my_past_orders');
-- Expected: prosecdef = true, proconfig = {search_path=""}, anon_exec = false, auth_exec = true.
--
-- How many finished, still-visible orders one customer would hide:
--   select count(*) from public.orders o
--   where o.customer_id = '<customer uuid>' and o.customer_archived_at is null
--     and (o.order_status in ('cancelled', 'rejected')
--          or exists (select 1 from public.delivery_requests d where d.order_id = o.id and d.status = 'completed'));
