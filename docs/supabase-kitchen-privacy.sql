-- ============================================================================
-- KOPI BOY — Kitchen privacy, Phase 1 (signed-out visitors)
--
-- Problem: the "Anyone can read live kitchens" policy plus the table-wide
-- `grant select on public.kitchens to anon` let anyone read every live
-- kitchen's paynow_type, paynow_value (may be a cook's mobile number),
-- latitude/longitude (a home kitchen's exact spot) and
-- acknowledged_terms_at.
--
-- This file:
--   1. get_order_paynow(order_id): PayNow details only for the signed-in
--      customer of that order, and only once the cook has accepted it.
--   2. kitchen_public_locations: kitchen coordinates rounded to 2 decimals
--      (about 1.1 km), for "near you" on the home page.
--   3. hero_candidates: the same rounding (it exposed exact coordinates to
--      anon through a security_invoker = false view). The copy in
--      docs/supabase-promotions.sql is rounded too, so re-running that file
--      doesn't bring the exact values back.
--   4. anon gets SELECT on exactly these kitchens columns:
--        id, business_name, category, cuisine_type, neighbourhood,
--        description, hero_image, is_live, created_at, updated_at,
--        business_uen, postal_sector, is_halal, is_blocked, live_since
--      Hidden from anon: paynow_type, paynow_value, latitude, longitude,
--      acknowledged_terms_at (and any column added later, until granted).
--
-- Signed-in users (role `authenticated`) are NOT restricted here — Phase 2.
-- The Partner app reads a cook's own kitchen and admins read every kitchen
-- through that same role, so it needs a Partner app change first. Until
-- then anyone who signs up can still read these columns.
--
-- is_blocked stays readable: the "Currently unavailable" label already shows
-- it, and the "No new orders to a blocked kitchen" policy on orders reads it
-- as the inserting user.
--
-- RUN ORDER: only after the Customer app that stops reading these columns
-- from kitchens is deployed (commit "Kitchen privacy Phase 1").
--
-- FAILS SAFELY: everything below section 0 runs in one transaction, and the
-- first step checks that every column it relies on exists. If one is
-- missing it stops with "kitchen_privacy: missing kitchens column(s): ..."
-- and NOTHING is changed. Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. CHECK FIRST (read only, run on its own). Lists the real columns and the
--    current anon / authenticated column grants on kitchens.
-- ----------------------------------------------------------------------------
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'kitchens'
-- order by ordinal_position;
--
-- select grantee, privilege_type, column_name
-- from information_schema.column_privileges
-- where table_schema = 'public' and table_name = 'kitchens' and grantee in ('anon', 'authenticated')
-- order by grantee, column_name;


begin;

-- ----------------------------------------------------------------------------
-- 0b. STOP IF A COLUMN IS MISSING (nothing has changed yet at this point).
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ' order by c) into v_missing
  from unnest(array[
    'id', 'business_name', 'category', 'cuisine_type', 'neighbourhood',
    'description', 'hero_image', 'is_live', 'created_at', 'updated_at',
    'business_uen', 'postal_sector', 'is_halal', 'is_blocked', 'live_since',
    'paynow_type', 'paynow_value', 'latitude', 'longitude', 'acknowledged_terms_at'
  ]) as c
  where not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = 'kitchens' and ic.column_name = c
  );
  if v_missing is not null then
    raise exception 'kitchen_privacy: missing kitchens column(s): %. Nothing was changed.', v_missing;
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 1. PAYNOW FOR THE CUSTOMER OF AN ACCEPTED ORDER
-- Not for 'placed': otherwise anyone could place and cancel an order just to
-- read a cook's number. The order page says "once accepted" before that.
-- No row for anyone else's order, a cancelled/rejected one, or signed out.
-- ----------------------------------------------------------------------------
create or replace function public.get_order_paynow(p_order_id uuid)
returns table (paynow_type text, paynow_value text)
language sql
stable
security definer
set search_path = public
as $$
  select k.paynow_type, k.paynow_value
  from public.orders o
  join public.kitchens k on k.id = o.kitchen_id
  where o.id = p_order_id
    and o.customer_id = auth.uid()
    and o.order_status = 'accepted';
$$;

revoke all on function public.get_order_paynow(uuid) from public, anon;
grant execute on function public.get_order_paynow(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. ROUNDED COORDINATES FOR "NEAR YOU"
-- 2 decimals is about 1.1 km in Singapore: plenty for the 8 km
-- NEW_KITCHENS_RADIUS_KM filter, too coarse to find a home. Delivery fees
-- don't use these: quote_delivery reads kitchen_addresses itself
-- (SECURITY DEFINER), so it keeps the exact location.
-- ----------------------------------------------------------------------------
create or replace view public.kitchen_public_locations
with (security_invoker = false) as
select k.id as kitchen_id,
       round(k.latitude::numeric, 2)::numeric(9,6) as latitude,
       round(k.longitude::numeric, 2)::numeric(9,6) as longitude
from public.kitchens k
where k.is_live
  and k.latitude is not null
  and k.longitude is not null;

revoke all on public.kitchen_public_locations from anon, authenticated;
grant select on public.kitchen_public_locations to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. HERO CANDIDATES WITH ROUNDED COORDINATES
-- Same definition as docs/supabase-promotions.sql (kept in step with it),
-- latitude/longitude rounded and cast back to numeric(9,6) so CREATE OR
-- REPLACE keeps the column types.
-- ----------------------------------------------------------------------------
create or replace view public.hero_candidates
with (security_invoker = false) as
with settings as (select * from public.app_settings where id),
excluded as (
  select e.kitchen_id, e.promotion_id
  from public.hero_exclusions e
  where e.until is null or e.until > now()
)
select case when d.kind = 'flash' then 'flash' else 'promotion' end as slide_kind,
       d.kitchen_id,
       d.id as promotion_id,
       k.business_name,
       k.hero_image,
       k.cuisine_type,
       round(k.latitude::numeric, 2)::numeric(9,6) as latitude,
       round(k.longitude::numeric, 2)::numeric(9,6) as longitude,
       d.title,
       d.ends_at,
       k.live_since
from public.active_deals d
join public.kitchens k on k.id = d.kitchen_id
cross join settings s
where s.hero_enabled
  and not exists (select 1 from excluded x where x.kitchen_id = d.kitchen_id or x.promotion_id = d.id)
union all
select 'new_kitchen',
       k.id,
       null::uuid,
       k.business_name,
       k.hero_image,
       k.cuisine_type,
       round(k.latitude::numeric, 2)::numeric(9,6),
       round(k.longitude::numeric, 2)::numeric(9,6),
       null::text,
       k.live_since + make_interval(days => s.new_kitchen_days),
       k.live_since
from public.kitchens k
cross join settings s
where s.hero_enabled
  and s.hero_include_new_kitchens
  and k.is_live
  and not coalesce(k.is_blocked, false)
  and k.live_since is not null
  and k.live_since > now() - make_interval(days => s.new_kitchen_days)
  and not exists (select 1 from excluded x where x.kitchen_id = k.id);

revoke all on public.hero_candidates from anon, authenticated;
grant select on public.hero_candidates to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4. ANON: EXACTLY THE PUBLIC KITCHEN COLUMNS
-- The table-wide grant goes, and so does any earlier column-level grant
-- (a table-level REVOKE leaves those in place), then the list is granted
-- back. RLS still limits anon to live kitchens. The RLS policies on
-- kitchens, menu_items, menu_option_groups and menu_options read is_live
-- (and is_blocked) as the caller, which is why those two stay granted.
-- ----------------------------------------------------------------------------
revoke select on public.kitchens from anon;

do $$
declare
  v_column text;
begin
  for v_column in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchens'
  loop
    execute format('revoke select (%I) on public.kitchens from anon', v_column);
  end loop;
end;
$$;

grant select (
  id,
  business_name,
  category,
  cuisine_type,
  neighbourhood,
  description,
  hero_image,
  is_live,
  created_at,
  updated_at,
  business_uen,
  postal_sector,
  is_halal,
  is_blocked,
  live_since
) on public.kitchens to anon;

commit;


-- ----------------------------------------------------------------------------
-- 5. CHECK AFTERWARDS (read only), in the SQL editor:
--
--   set role anon;
--   select paynow_value from public.kitchens limit 1;   -- permission denied
--   select latitude from public.kitchens limit 1;       -- permission denied
--   select id, business_name, postal_sector, is_blocked from public.kitchens limit 1;  -- works
--   select count(*) from public.menu_items;             -- works
--   select * from public.kitchen_public_locations limit 3;  -- 2-decimal values
--   reset role;
--
-- UNDO (puts back the old table-wide anon grant; the new function and views
-- are harmless and can stay):
--   grant select on public.kitchens to anon;
-- ----------------------------------------------------------------------------
