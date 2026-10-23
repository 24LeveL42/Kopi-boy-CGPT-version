-- KOPI BOY — kitchen promotions: settings, deal tables, read-only views,
-- server-side pricing and the place_order function (Phase B, plumbing only).
--
-- Deploy the app first, run PART 1 any time, run PART 2 only after the app is
-- live and off-peak, then do a full order test.
--
-- Why that order:
--   * The app calls place_order through the service role and, while the
--     function doesn't exist yet (PostgREST PGRST202), places the order the
--     old way. So the app can go out before any of this runs.
--   * PART 1 only adds new tables, views and one kitchens column/trigger.
--     Nothing in it touches orders. Deals stay invisible until
--     app_settings.deals_enabled is switched on (default false).
--   * PART 2 adds order columns (food_total is a STORED generated column, so
--     adding it rewrites the orders table under a short exclusive lock:
--     off-peak), the pricing and ordering functions, and the guards that stop
--     browsers inserting orders directly. From then on every order goes
--     through place_order.
--   * Switch deals on (section 1 of HOW TO CHECK) only after the order test.
--
-- Safe to run again: create ... if not exists, create or replace, and
-- drop ... if exists before every trigger, policy and cron job. No data is
-- deleted. Phase B gives READ policies only; promotion writes (Partner and
-- Boss screens) come in Phase C.
--
-- Every function below that is SECURITY DEFINER uses search_path = '' and
-- schema-qualifies every name.


-- ############################################################################
-- PART 1 — settings, deal tables and views (no effect on orders)
-- ############################################################################

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.1 APP SETTINGS — exactly one row (id is always true)
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  new_kitchen_days integer not null default 14 check (new_kitchen_days between 1 and 365),
  deals_enabled boolean not null default false,
  max_percent_off numeric(5,2) not null default 50 check (max_percent_off > 0 and max_percent_off <= 100),
  max_deal_days integer not null default 30 check (max_deal_days between 1 and 365),
  hero_enabled boolean not null default true,
  hero_rotation_seconds integer not null default 5 check (hero_rotation_seconds between 3 and 30),
  hero_max_slides integer not null default 6 check (hero_max_slides between 1 and 20),
  hero_max_per_kitchen integer not null default 1 check (hero_max_per_kitchen between 1 and 5),
  hero_include_new_kitchens boolean not null default true,
  near_radius_km numeric(5,2) not null default 8 check (near_radius_km > 0 and near_radius_km <= 50),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "Anyone can read app settings" on public.app_settings;
create policy "Anyone can read app settings"
  on public.app_settings for select
  using (true);

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.2 KITCHENS.LIVE_SINCE — when the kitchen first went live (the NEW rule)
-- Backfilled from created_at for kitchens already live. Stamped by the
-- database the first time is_live becomes true; a browser can never set or
-- move it (a cook could otherwise stay "NEW" forever). Never cleared, so a
-- kitchen that goes offline and back keeps its first date.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists live_since timestamptz;

update public.kitchens
set live_since = created_at
where is_live and live_since is null;

create or replace function private.kitchens_live_since_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.live_since := null;
    else
      new.live_since := old.live_since;
    end if;
  end if;

  if new.is_live and new.live_since is null then
    new.live_since := now();
  end if;
  return new;
end;
$$;

revoke all on function private.kitchens_live_since_stamp() from public, anon, authenticated;

drop trigger if exists kitchens_live_since_stamp on public.kitchens;
create trigger kitchens_live_since_stamp
  before insert or update on public.kitchens
  for each row execute function private.kitchens_live_since_stamp();

-- ----------------------------------------------------------------------------
-- 1.3 PROMOTIONS — created and funded by one kitchen
--
-- kind (same list as src/lib/deals.ts DEAL_KINDS) and the numbers it uses:
--   percent_off   percent_off on eligible items (optional min_spend)
--   amount_off    amount_off off eligible items (optional min_spend)
--   buy_x_get_y   for every buy_qty + get_qty eligible units, the get_qty
--                 cheapest are free
--   free_item     one unit of free_item_id free when it's in the cart
--                 (optional min_spend, counted without the free item)
--   min_spend     percent_off or amount_off once the order reaches min_spend
--   limited_qty   deal_price / percent_off / amount_off per unit, only for
--                 the first quantity_limit units sold
--   flash         same as limited_qty, normally a short window
-- Eligible items are the rows in promotion_items; none = the whole menu.
-- quantity_limit counts portions for flash/limited_qty and redemptions
-- (orders) for every other kind; null = unlimited.
-- ----------------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  kind text not null check (kind in ('percent_off', 'amount_off', 'buy_x_get_y', 'free_item', 'min_spend', 'limited_qty', 'flash')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  terms text check (terms is null or char_length(terms) <= 1000),
  percent_off numeric(5,2) check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  amount_off numeric(7,2) check (amount_off is null or amount_off > 0),
  buy_qty integer check (buy_qty is null or buy_qty between 1 and 99),
  get_qty integer check (get_qty is null or get_qty between 1 and 99),
  min_spend numeric(7,2) check (min_spend is null or min_spend > 0),
  deal_price numeric(7,2) check (deal_price is null or deal_price > 0),
  free_item_id uuid references public.menu_items(id) on delete set null,
  quantity_limit integer check (quantity_limit is null or quantity_limit > 0),
  quantity_claimed integer not null default 0 check (quantity_claimed >= 0),
  per_customer_limit integer check (per_customer_limit is null or per_customer_limit > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  disabled_by_admin_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_window_check check (ends_at > starts_at)
);

create index if not exists promotions_kitchen_window_idx on public.promotions (kitchen_id, ends_at);

create table if not exists public.promotion_items (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  primary key (promotion_id, menu_item_id)
);

create index if not exists promotion_items_menu_item_idx on public.promotion_items (menu_item_id);

-- HQ can stop a kitchen running deals at all, and keep kitchens or single
-- promotions out of the hero carousel.
create table if not exists public.kitchen_deal_bans (
  kitchen_id uuid primary key references public.kitchens(id) on delete cascade,
  reason text,
  banned_at timestamptz not null default now(),
  banned_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.hero_exclusions (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid references public.kitchens(id) on delete cascade,
  promotion_id uuid references public.promotions(id) on delete cascade,
  reason text,
  until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint hero_exclusions_target_check check (kitchen_id is not null or promotion_id is not null)
);

-- ----------------------------------------------------------------------------
-- 1.4 RLS — read policies only in Phase B
-- ----------------------------------------------------------------------------
alter table public.promotions enable row level security;
alter table public.promotion_items enable row level security;
alter table public.kitchen_deal_bans enable row level security;
alter table public.hero_exclusions enable row level security;

drop policy if exists "Anyone can read running promotions" on public.promotions;
create policy "Anyone can read running promotions"
  on public.promotions for select
  using (is_active and disabled_by_admin_at is null and starts_at <= now() and ends_at > now());

drop policy if exists "Cooks can read their own promotions" on public.promotions;
create policy "Cooks can read their own promotions"
  on public.promotions for select
  using (auth.uid() = kitchen_id);

drop policy if exists "Admins can read every promotion" on public.promotions;
create policy "Admins can read every promotion"
  on public.promotions for select
  using (public.has_role('admin'));

-- The promotions subquery runs under the reader's own promotions policies, so
-- an item row is visible exactly when its promotion is.
drop policy if exists "Promotion items follow their promotion" on public.promotion_items;
create policy "Promotion items follow their promotion"
  on public.promotion_items for select
  using (exists (select 1 from public.promotions p where p.id = promotion_items.promotion_id));

drop policy if exists "Cooks can read their own deal ban" on public.kitchen_deal_bans;
create policy "Cooks can read their own deal ban"
  on public.kitchen_deal_bans for select
  using (auth.uid() = kitchen_id);

drop policy if exists "Admins can read every deal ban" on public.kitchen_deal_bans;
create policy "Admins can read every deal ban"
  on public.kitchen_deal_bans for select
  using (public.has_role('admin'));

drop policy if exists "Admins can read every hero exclusion" on public.hero_exclusions;
create policy "Admins can read every hero exclusion"
  on public.hero_exclusions for select
  using (public.has_role('admin'));

-- Supabase's default privileges grant everything on new tables; start from
-- zero and give back reads only.
revoke all on public.promotions, public.promotion_items, public.kitchen_deal_bans, public.hero_exclusions from anon, authenticated;
grant select on public.promotions, public.promotion_items to anon, authenticated;
grant select on public.kitchen_deal_bans, public.hero_exclusions to authenticated;

-- ----------------------------------------------------------------------------
-- 1.5 LIVE PROMOTIONS — the one definition of "this deal is running now"
-- Used by the public views below and by the pricing in PART 2, so what a
-- customer sees and what checkout charges can't disagree. A deal is live
-- when: deals are switched on; the kitchen is live, not blocked and not
-- banned from deals; the deal is active, not disabled by HQ, inside its
-- window, within max_deal_days, within max_percent_off, and not sold out.
-- Private schema: only the owner (views, SECURITY DEFINER functions) reads it.
-- ----------------------------------------------------------------------------
create or replace view private.live_promotions as
select p.*,
       case when p.quantity_limit is null then null else greatest(p.quantity_limit - p.quantity_claimed, 0) end as remaining_qty
from public.promotions p
join public.kitchens k on k.id = p.kitchen_id
cross join public.app_settings s
where s.deals_enabled
  and k.is_live
  and not coalesce(k.is_blocked, false)
  and not exists (select 1 from public.kitchen_deal_bans b where b.kitchen_id = p.kitchen_id)
  and p.is_active
  and p.disabled_by_admin_at is null
  and p.starts_at <= now()
  and p.ends_at > now()
  and p.ends_at - p.starts_at <= make_interval(days => s.max_deal_days)
  and (p.percent_off is null or p.percent_off <= s.max_percent_off)
  and (p.quantity_limit is null or p.quantity_claimed < p.quantity_limit);

revoke all on private.live_promotions from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1.6 PUBLIC VIEWS — security_invoker = false on purpose, like
-- kitchen_rating_summary (schema section 32): they run as the owner, so
-- customers never need to read bans or settings, and they only ever expose
-- live deals.
-- ----------------------------------------------------------------------------

-- Everything a customer screen may show about a running deal.
-- item_name / original_price: the free item, or the single eligible item
-- when there is exactly one (flash and limited-quantity cards).
create or replace view public.active_deals
with (security_invoker = false) as
select lp.id,
       lp.kitchen_id,
       k.business_name,
       lp.kind,
       lp.title,
       lp.description,
       lp.terms,
       lp.percent_off,
       lp.amount_off,
       lp.buy_qty,
       lp.get_qty,
       coalesce(fi.name, single.name) as item_name,
       coalesce(fi.price, single.price) as original_price,
       lp.min_spend,
       lp.deal_price,
       lp.starts_at,
       lp.ends_at,
       lp.remaining_qty,
       lp.quantity_limit,
       lp.per_customer_limit,
       coalesce(items.ids, '{}'::uuid[]) as eligible_item_ids
from private.live_promotions lp
join public.kitchens k on k.id = lp.kitchen_id
left join public.menu_items fi on fi.id = lp.free_item_id and fi.kitchen_id = lp.kitchen_id
left join lateral (
  select array_agg(pi.menu_item_id order by pi.menu_item_id) as ids, count(*) as n
  from public.promotion_items pi
  where pi.promotion_id = lp.id
) items on true
left join lateral (
  select m.name, m.price
  from public.promotion_items pi
  join public.menu_items m on m.id = pi.menu_item_id
  where pi.promotion_id = lp.id and items.n = 1
) single on true;

revoke all on public.active_deals from anon, authenticated;
grant select on public.active_deals to anon, authenticated;

-- Exactly the columns src/lib/deals-server.ts reads (DEAL_COLUMNS).
create or replace view public.kitchen_active_deals
with (security_invoker = false) as
select id, kitchen_id, kind, title, percent_off, amount_off, buy_qty, get_qty, item_name,
       min_spend, original_price, deal_price, starts_at, ends_at, remaining_qty
from public.active_deals;

revoke all on public.kitchen_active_deals from anon, authenticated;
grant select on public.kitchen_active_deals to anon, authenticated;

-- One row per kitchen with a running deal: ⚡ FLASH wins over 🏷️ DEALS.
create or replace view public.kitchen_deal_badges
with (security_invoker = false) as
select kitchen_id,
       count(*)::integer as deal_count,
       bool_or(kind = 'flash') as has_flash,
       min(ends_at) as next_ends_at
from public.active_deals
group by kitchen_id;

revoke all on public.kitchen_deal_badges from anon, authenticated;
grant select on public.kitchen_deal_badges to anon, authenticated;

-- What the hero carousel may show: running deals and new kitchens, minus HQ's
-- exclusions. Location filtering and fair rotation are the app's job (it
-- knows the customer's address); latitude/longitude are here for that.
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
       k.latitude,
       k.longitude,
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
       k.latitude,
       k.longitude,
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

-- Every promotion with its status, for the cook's own list and HQ's list.
-- security_invoker = true: the promotions policies decide who sees what
-- (a cook their own, an admin all; anyone else only running ones).
create or replace view public.promotion_overview
with (security_invoker = true) as
select p.id,
       p.kitchen_id,
       p.kind,
       p.title,
       p.starts_at,
       p.ends_at,
       p.is_active,
       p.disabled_by_admin_at,
       p.disabled_reason,
       p.quantity_limit,
       p.quantity_claimed,
       case
         when p.disabled_by_admin_at is not null then 'disabled_by_admin'
         when not p.is_active then 'inactive'
         when p.ends_at <= now() then 'expired'
         when p.starts_at > now() then 'upcoming'
         when p.quantity_limit is not null and p.quantity_claimed >= p.quantity_limit then 'sold_out'
         else 'running'
       end as status,
       p.created_at,
       p.updated_at
from public.promotions p;

revoke all on public.promotion_overview from anon, authenticated;
grant select on public.promotion_overview to authenticated;


-- ############################################################################
-- PART 2 — order pricing and place_order (run after the app is live, off-peak)
-- ############################################################################

-- ----------------------------------------------------------------------------
-- 2.1 ORDER COLUMNS
-- subtotal stays the gross food total (so the subtotal > 0 check holds);
-- discount_total is what the kitchen's deal takes off; food_total is what the
-- customer pays for the food. delivery_fee_estimate is unchanged.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists discount_total numeric(7,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_total_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_discount_total_check
      check (discount_total >= 0 and discount_total <= subtotal);
  end if;
end;
$$;

alter table public.orders add column if not exists food_total numeric(7,2)
  generated always as (subtotal - discount_total) stored;

alter table public.orders add column if not exists promotion_id uuid references public.promotions(id) on delete set null;
alter table public.orders add column if not exists promotion_kind text;
alter table public.orders add column if not exists promotion_label text;
alter table public.orders add column if not exists promotion_units integer;
alter table public.orders add column if not exists promotion_released_at timestamptz;
alter table public.orders add column if not exists request_id uuid;

create unique index if not exists orders_customer_request_id_key
  on public.orders (customer_id, request_id)
  where request_id is not null;

create index if not exists orders_promotion_idx
  on public.orders (promotion_id)
  where promotion_id is not null;

alter table public.order_items add column if not exists discount_amount numeric(7,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_discount_amount_check' and conrelid = 'public.order_items'::regclass) then
    alter table public.order_items add constraint order_items_discount_amount_check check (discount_amount >= 0);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2.2 CART ITEMS — validate and merge
-- [{ "menu_item_id": uuid, "quantity": 1..99 }, ...] -> the same shape with
-- duplicate ids merged (first position kept). Raises empty_cart,
-- invalid_item or invalid_quantity.
-- ----------------------------------------------------------------------------
create or replace function private.normalize_order_items(p_items jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id text;
  v_qty numeric;
  v_result jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart';
  end if;

  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_item';
    end if;
    v_id := v_item->>'menu_item_id';
    if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_item';
    end if;
    if jsonb_typeof(v_item->'quantity') is distinct from 'number' then
      raise exception 'invalid_quantity';
    end if;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_quantity';
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object('menu_item_id', id, 'quantity', qty) order by first_pos)
    into v_result
  from (
    select lower(e->>'menu_item_id')::uuid as id,
           sum((e->>'quantity')::integer) as qty,
           min(pos) as first_pos
    from jsonb_array_elements(p_items) with ordinality t(e, pos)
    group by lower(e->>'menu_item_id')::uuid
  ) merged;

  if exists (select 1 from jsonb_array_elements(v_result) e where (e->>'quantity')::integer > 99) then
    raise exception 'invalid_quantity';
  end if;
  return v_result;
end;
$$;

revoke all on function private.normalize_order_items(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2.3 ONE PROMOTION'S DISCOUNT ON A PRICED CART
-- Eligible lines first: the promotion's items, or every line when it has none.
-- ----------------------------------------------------------------------------
create or replace function private.promotion_eligible_lines(p_promotion_id uuid, p_lines jsonb)
returns table (menu_item_id uuid, price numeric, quantity integer)
language sql
stable
set search_path = ''
as $$
  select (e->>'menu_item_id')::uuid, (e->>'price')::numeric, (e->>'quantity')::integer
  from jsonb_array_elements(p_lines) e
  where not exists (select 1 from public.promotion_items pi where pi.promotion_id = p_promotion_id)
     or exists (
       select 1 from public.promotion_items pi
       where pi.promotion_id = p_promotion_id and pi.menu_item_id = (e->>'menu_item_id')::uuid
     );
$$;

revoke all on function private.promotion_eligible_lines(uuid, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- p_lines: [{ menu_item_id, name, price, quantity }] priced from menu_items.
-- Returns { "lines": { "<menu_item_id>": discount, ... }, "units": n } with
-- every amount rounded to 2 dp and never more than its line. Empty lines =
-- the deal doesn't apply.
-- ----------------------------------------------------------------------------
create or replace function private.promotion_discounts(p public.promotions, p_lines jsonb, p_subtotal numeric)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lines jsonb := '{}'::jsonb;
  v_units integer := 1;
  v_eligible numeric;
  v_off numeric;
  v_free integer;
  v_remaining integer;
  v_free_price numeric;
begin
  if p.kind = 'free_item' then
    select (e->>'price')::numeric into v_free_price
    from jsonb_array_elements(p_lines) e
    where (e->>'menu_item_id')::uuid = p.free_item_id;
    if v_free_price is null or v_free_price <= 0 then
      return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
    end if;
    if p.min_spend is not null and p_subtotal - v_free_price < p.min_spend then
      return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
    end if;
    return jsonb_build_object('lines', jsonb_build_object(p.free_item_id::text, round(v_free_price, 2)), 'units', 1);
  end if;

  if p.kind = 'min_spend' and p.min_spend is null then
    return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
  end if;
  if p.min_spend is not null and p_subtotal < p.min_spend then
    return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
  end if;

  if p.kind in ('percent_off', 'amount_off', 'min_spend') then
    if p.percent_off is not null and p.kind <> 'amount_off' then
      select coalesce(jsonb_object_agg(menu_item_id::text, d) filter (where d > 0), '{}'::jsonb) into v_lines
      from (
        select menu_item_id, round(price * quantity * p.percent_off / 100, 2) as d
        from private.promotion_eligible_lines(p.id, p_lines)
      ) s;
    elsif p.amount_off is not null and p.kind <> 'percent_off' then
      select coalesce(sum(price * quantity), 0) into v_eligible from private.promotion_eligible_lines(p.id, p_lines);
      if v_eligible <= 0 then
        return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
      end if;
      v_off := least(p.amount_off, v_eligible);
      -- Spread across lines by value; the biggest line takes the rounding cents.
      select coalesce(jsonb_object_agg(menu_item_id::text, d) filter (where d > 0), '{}'::jsonb) into v_lines
      from (
        select menu_item_id,
               least(sh.t, greatest(0, sh.share + case when sh.rn = 1 then v_off - sum(sh.share) over () else 0 end)) as d
        from (
          select menu_item_id,
                 price * quantity as t,
                 round(v_off * price * quantity / v_eligible, 2) as share,
                 row_number() over (order by price * quantity desc, menu_item_id) as rn
          from private.promotion_eligible_lines(p.id, p_lines)
        ) sh
      ) s;
    end if;
    return jsonb_build_object('lines', v_lines, 'units', 1);
  end if;

  if p.kind = 'buy_x_get_y' then
    if p.buy_qty is null or p.get_qty is null then
      return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
    end if;
    select (coalesce(sum(quantity), 0) / (p.buy_qty + p.get_qty)) * p.get_qty into v_free from private.promotion_eligible_lines(p.id, p_lines);
    select coalesce(jsonb_object_agg(menu_item_id::text, d), '{}'::jsonb) into v_lines
    from (
      select menu_item_id, round(sum(price), 2) as d
      from (
        select l.menu_item_id, l.price, row_number() over (order by l.price, l.menu_item_id) as rn
        from private.promotion_eligible_lines(p.id, p_lines) l
        cross join lateral generate_series(1, l.quantity)
      ) u
      where rn <= v_free
      group by menu_item_id
    ) s
    where d > 0;
    return jsonb_build_object('lines', v_lines, 'units', 1);
  end if;

  if p.kind in ('limited_qty', 'flash') then
    v_remaining := case when p.quantity_limit is null then 99 * 100 else greatest(p.quantity_limit - p.quantity_claimed, 0) end;
    -- The most expensive eligible units first, up to what's left.
    select coalesce(jsonb_object_agg(menu_item_id::text, d), '{}'::jsonb), coalesce(sum(n), 0)::integer
      into v_lines, v_units
    from (
      select menu_item_id, round(sum(unit_off), 2) as d, count(*) as n
      from (
        select l.menu_item_id,
               case
                 when p.deal_price is not null then greatest(l.price - p.deal_price, 0)
                 when p.percent_off is not null then round(l.price * p.percent_off / 100, 2)
                 when p.amount_off is not null then least(p.amount_off, l.price)
                 else 0
               end as unit_off,
               row_number() over (order by l.price desc, l.menu_item_id) as rn
        from private.promotion_eligible_lines(p.id, p_lines) l
        cross join lateral generate_series(1, l.quantity)
      ) u
      where rn <= v_remaining and unit_off > 0
      group by menu_item_id
    ) s
    where d > 0;
    return jsonb_build_object('lines', v_lines, 'units', v_units);
  end if;

  return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
end;
$$;

revoke all on function private.promotion_discounts(public.promotions, jsonb, numeric) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2.4 COMPUTE ORDER PRICING — prices from menu_items, best single deal
-- Every price comes from menu_items; every item must belong to the kitchen.
-- No stacking: the one live deal with the biggest discount wins; ties go to
-- the deal ending soonest, then the lowest id. per_customer_limit counts the
-- customer's orders that still hold the deal (not cancelled/rejected).
-- Returns { subtotal, discount_total, food_total, promotion_id,
-- promotion_kind, promotion_label, promotion_units, lines: [...] }.
-- Raises empty_cart / invalid_item / invalid_quantity / item_unavailable.
-- SECURITY DEFINER so it can read the private helpers; executable only by
-- service_role (and the owner, i.e. the functions below).
-- ----------------------------------------------------------------------------
create or replace function public.compute_order_pricing(p_kitchen_id uuid, p_items jsonb, p_customer_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_lines jsonb;
  v_count integer;
  v_subtotal numeric;
  v_promo public.promotions;
  v_result jsonb;
  v_total numeric;
  v_best public.promotions;
  v_best_lines jsonb := '{}'::jsonb;
  v_best_total numeric := 0;
  v_best_units integer := 0;
begin
  v_items := private.normalize_order_items(p_items);

  select jsonb_agg(jsonb_build_object('menu_item_id', m.id, 'name', m.name, 'price', m.price, 'quantity', i.qty) order by i.pos),
         count(*),
         round(coalesce(sum(m.price * i.qty), 0), 2)
    into v_lines, v_count, v_subtotal
  from (
    select (e->>'menu_item_id')::uuid as id, (e->>'quantity')::integer as qty, pos
    from jsonb_array_elements(v_items) with ordinality t(e, pos)
  ) i
  join public.menu_items m on m.id = i.id and m.kitchen_id = p_kitchen_id;

  if v_count is distinct from jsonb_array_length(v_items) then
    raise exception 'item_unavailable';
  end if;
  if v_subtotal <= 0 then
    raise exception 'item_unavailable';
  end if;

  for v_promo in
    select p.*
    from public.promotions p
    where p.kitchen_id = p_kitchen_id
      and p.id in (select lp.id from private.live_promotions lp)
    order by p.ends_at, p.id
  loop
    if p_customer_id is not null and v_promo.per_customer_limit is not null and (
      select count(*) from public.orders o
      where o.customer_id = p_customer_id
        and o.promotion_id = v_promo.id
        and o.order_status not in ('cancelled', 'rejected')
    ) >= v_promo.per_customer_limit then
      continue;
    end if;

    v_result := private.promotion_discounts(v_promo, v_lines, v_subtotal);
    select coalesce(sum(value::numeric), 0) into v_total from jsonb_each_text(v_result->'lines');
    v_total := least(v_total, v_subtotal);
    -- Strictly bigger only: the loop order already puts the tie winner first.
    if v_total > v_best_total then
      v_best := v_promo;
      v_best_total := v_total;
      v_best_lines := v_result->'lines';
      v_best_units := (v_result->>'units')::integer;
    end if;
  end loop;

  return jsonb_build_object(
    'subtotal', v_subtotal,
    'discount_total', round(v_best_total, 2),
    'food_total', round(v_subtotal - v_best_total, 2),
    'promotion_id', case when v_best_total > 0 then v_best.id end,
    'promotion_kind', case when v_best_total > 0 then v_best.kind end,
    'promotion_label', case when v_best_total > 0 then v_best.title end,
    'promotion_units', case when v_best_total > 0 then v_best_units end,
    'lines', (
      select jsonb_agg(l || jsonb_build_object('discount_amount', coalesce((v_best_lines->>(l->>'menu_item_id'))::numeric, 0)))
      from jsonb_array_elements(v_lines) l
    )
  );
end;
$$;

revoke execute on function public.compute_order_pricing(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.compute_order_pricing(uuid, jsonb, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 2.5 QUOTE ORDER PRICING — the cart's preview (display only)
-- Same numbers place_order would use right now, for the signed-in customer
-- (per-customer limits) or anyone. The cart hides the Deal line when this is
-- missing or fails. Raises kitchen_unavailable for a kitchen not taking orders.
-- ----------------------------------------------------------------------------
create or replace function public.quote_order_pricing(p_kitchen_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pricing jsonb;
begin
  if not exists (
    select 1 from public.kitchens k
    where k.id = p_kitchen_id and k.is_live and not coalesce(k.is_blocked, false)
  ) then
    raise exception 'kitchen_unavailable';
  end if;
  v_pricing := public.compute_order_pricing(p_kitchen_id, p_items, auth.uid());
  return v_pricing - 'lines' - 'promotion_units';
end;
$$;

revoke execute on function public.quote_order_pricing(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.quote_order_pricing(uuid, jsonb) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2.6 PLACE ORDER — the only way an order is created
-- Called by the Customer app's placeOrder() server action with the service
-- role (src/lib/supabase/admin.ts); never by a browser. One transaction:
--   1. a repeated p_request_id returns that customer's existing order;
--   2. the kitchen must be live and not blocked;
--   3. quote_delivery, unchanged, gives distance and fee from the
--      coordinates the server geocoded;
--   4. menu items, then the kitchen's live promotions, are locked (in id
--      order) so prices can't change and two orders can't both take the
--      last flash portion;
--   5. compute_order_pricing prices it;
--   6. p_expected (what the customer was shown: food_total, delivery_fee)
--      must match, otherwise pricing_changed is raised with the new numbers
--      as JSON in DETAIL and nothing is created;
--   7. order and items are inserted, and the deal's quantity_claimed goes up.
-- p_delivery: { delivery_type, lat, lng, postal_code, scheduled_for,
--               address_line, unit, notes }.
-- Returns { order_id, existing, subtotal, discount_total, food_total,
--           delivery_fee, promotion_label }.
-- ----------------------------------------------------------------------------
create or replace function public.place_order(
  p_customer_id uuid,
  p_kitchen_id uuid,
  p_items jsonb,
  p_delivery jsonb,
  p_expected jsonb default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_kitchen record;
  v_type text;
  v_lat double precision;
  v_lng double precision;
  v_scheduled timestamptz;
  v_distance numeric;
  v_fee numeric;
  v_items jsonb;
  v_pricing jsonb;
  v_order_id uuid;
  v_promotion_id uuid;
  v_units integer;
begin
  if p_customer_id is null or p_kitchen_id is null then
    raise exception 'invalid_request';
  end if;

  if p_request_id is not null then
    select o.* into v_order from public.orders o
    where o.customer_id = p_customer_id and o.request_id = p_request_id;
    if found then
      return jsonb_build_object(
        'order_id', v_order.id, 'existing', true,
        'subtotal', v_order.subtotal, 'discount_total', v_order.discount_total, 'food_total', v_order.food_total,
        'delivery_fee', v_order.delivery_fee_estimate, 'promotion_label', v_order.promotion_label
      );
    end if;
  end if;

  select k.is_live, coalesce(k.is_blocked, false) as is_blocked into v_kitchen
  from public.kitchens k where k.id = p_kitchen_id;
  if not found or not v_kitchen.is_live then
    raise exception 'kitchen_unavailable';
  end if;
  if v_kitchen.is_blocked then
    raise exception 'kitchen_blocked';
  end if;

  v_type := p_delivery->>'delivery_type';
  if v_type is null or v_type not in ('normal', 'express') then
    raise exception 'invalid_delivery_type';
  end if;
  if jsonb_typeof(p_delivery->'lat') is distinct from 'number' or jsonb_typeof(p_delivery->'lng') is distinct from 'number' then
    raise exception 'invalid_location';
  end if;
  v_lat := (p_delivery->>'lat')::double precision;
  v_lng := (p_delivery->>'lng')::double precision;
  if nullif(p_delivery->>'scheduled_for', '') is not null then
    v_scheduled := (p_delivery->>'scheduled_for')::timestamptz;
    if v_scheduled <= now() then
      raise exception 'invalid_schedule';
    end if;
  end if;
  if char_length(coalesce(p_delivery->>'notes', '')) > 200 or char_length(coalesce(p_delivery->>'unit', '')) > 50 then
    raise exception 'invalid_address';
  end if;

  select q.distance_km, q.delivery_fee into v_distance, v_fee
  from public.quote_delivery(p_kitchen_id, v_lat, v_lng, v_type) q;
  if v_fee is null then
    raise exception 'delivery_quote_failed';
  end if;

  v_items := private.normalize_order_items(p_items);

  perform 1 from public.menu_items m
  where m.id in (select (e->>'menu_item_id')::uuid from jsonb_array_elements(v_items) e)
  order by m.id
  for share;

  perform 1 from public.promotions p
  where p.kitchen_id = p_kitchen_id
    and p.id in (select lp.id from private.live_promotions lp)
  order by p.id
  for update;

  v_pricing := public.compute_order_pricing(p_kitchen_id, v_items, p_customer_id);

  if p_expected is not null and (
    (p_expected ? 'food_total' and abs((p_expected->>'food_total')::numeric - (v_pricing->>'food_total')::numeric) >= 0.005)
    or (p_expected ? 'delivery_fee' and abs((p_expected->>'delivery_fee')::numeric - v_fee) >= 0.005)
  ) then
    raise exception 'pricing_changed' using detail = jsonb_build_object(
      'subtotal', (v_pricing->>'subtotal')::numeric,
      'discount_total', (v_pricing->>'discount_total')::numeric,
      'food_total', (v_pricing->>'food_total')::numeric,
      'delivery_fee', v_fee,
      'promotion_label', v_pricing->>'promotion_label'
    )::text;
  end if;

  v_promotion_id := nullif(v_pricing->>'promotion_id', '')::uuid;
  v_units := nullif(v_pricing->>'promotion_units', '')::integer;

  begin
    insert into public.orders (
      customer_id, kitchen_id, subtotal, discount_total,
      promotion_id, promotion_kind, promotion_label, promotion_units, request_id,
      customer_postal_code, customer_lat, customer_lng,
      delivery_type, delivery_distance_km, delivery_fee_estimate, scheduled_for,
      delivery_address_line, delivery_unit, delivery_notes
    ) values (
      p_customer_id, p_kitchen_id, (v_pricing->>'subtotal')::numeric, (v_pricing->>'discount_total')::numeric,
      v_promotion_id, v_pricing->>'promotion_kind', v_pricing->>'promotion_label', v_units, p_request_id,
      nullif(p_delivery->>'postal_code', ''), v_lat, v_lng,
      v_type, v_distance, v_fee, v_scheduled,
      nullif(p_delivery->>'address_line', ''), nullif(p_delivery->>'unit', ''), nullif(p_delivery->>'notes', '')
    )
    returning id into v_order_id;
  exception when unique_violation then
    -- The same request won a race with this one: hand back its order.
    select o.* into v_order from public.orders o
    where o.customer_id = p_customer_id and o.request_id = p_request_id;
    if not found then
      raise;
    end if;
    return jsonb_build_object(
      'order_id', v_order.id, 'existing', true,
      'subtotal', v_order.subtotal, 'discount_total', v_order.discount_total, 'food_total', v_order.food_total,
      'delivery_fee', v_order.delivery_fee_estimate, 'promotion_label', v_order.promotion_label
    );
  end;

  insert into public.order_items (order_id, menu_item_id, name, price, quantity, discount_amount)
  select v_order_id,
         (l->>'menu_item_id')::uuid,
         l->>'name',
         (l->>'price')::numeric,
         (l->>'quantity')::integer,
         (l->>'discount_amount')::numeric
  from jsonb_array_elements(v_pricing->'lines') l;

  if v_promotion_id is not null then
    update public.promotions
    set quantity_claimed = quantity_claimed + coalesce(v_units, 1)
    where id = v_promotion_id;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id, 'existing', false,
    'subtotal', (v_pricing->>'subtotal')::numeric,
    'discount_total', (v_pricing->>'discount_total')::numeric,
    'food_total', (v_pricing->>'food_total')::numeric,
    'delivery_fee', v_fee,
    'promotion_label', v_pricing->>'promotion_label'
  );
end;
$$;

revoke execute on function public.place_order(uuid, uuid, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.place_order(uuid, uuid, jsonb, jsonb, jsonb, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 2.7 GIVE A DEAL BACK WHEN ITS ORDER IS CANCELLED OR REJECTED
-- BEFORE UPDATE, so it stamps promotion_released_at on the same row write
-- (no second UPDATE, so no second round of order triggers). Fires after
-- orders_client_guard (alphabetical), so the guard can't undo the stamp.
-- Idempotent: only while promotion_released_at is null. Never blocks the
-- cancel: any error becomes a warning, and the cron job below retries.
-- ----------------------------------------------------------------------------
create or replace function private.orders_release_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.promotion_id is not null
    and new.promotion_released_at is null
    and new.order_status in ('cancelled', 'rejected') then
    begin
      update public.promotions
      set quantity_claimed = greatest(quantity_claimed - coalesce(new.promotion_units, 1), 0)
      where id = new.promotion_id;
      new.promotion_released_at := now();
    exception when others then
      raise warning 'orders_release_promotion failed for order %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.orders_release_promotion() from public, anon, authenticated;

drop trigger if exists orders_release_promotion on public.orders;
create trigger orders_release_promotion
  before update on public.orders
  for each row execute function private.orders_release_promotion();

-- Sweeper for any release the trigger couldn't do. Sets promotion_released_at
-- itself, so the trigger above skips the row.
create or replace function private.release_stale_promotions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select o.id, o.promotion_id, o.promotion_units
    from public.orders o
    where o.promotion_id is not null
      and o.promotion_released_at is null
      and o.order_status in ('cancelled', 'rejected')
    order by o.id
    limit 500
    for update skip locked
  loop
    update public.promotions
    set quantity_claimed = greatest(quantity_claimed - coalesce(r.promotion_units, 1), 0)
    where id = r.promotion_id;
    update public.orders set promotion_released_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.release_stale_promotions() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'kb-release-promotions';
select cron.schedule('kb-release-promotions', '*/10 * * * *', 'select private.release_stale_promotions()');

-- ----------------------------------------------------------------------------
-- 2.8 CLIENT GUARDS — what a browser may still change on an order
-- SECURITY INVOKER, so current_user is the caller: only anon/authenticated
-- are checked; service_role, postgres, cron and every SECURITY DEFINER
-- function (place_order, submit_payment_proof, the archive and the
-- auto-cancel, the hide RPCs) pass straight through. The name sorts after
-- guard_cook_hidden_at and before orders_payment_timer, orders_release_promotion
-- and protect_customer_archived_at, which run after it.
--
-- INSERT: refused (orders_must_use_place_order).
-- UPDATE: every money, delivery, address, proof, deadline, cancel-reason,
-- archive and promotion column silently keeps its old value. Then:
--   cook (auth.uid() = kitchen_id) may only
--     - move order_status placed -> accepted or rejected
--     - move payment_status unpaid -> paid while accepted
--     - set payment_proof_rejected_at while accepted and unpaid
--     - move preparation_status forward (not_started -> preparing -> ready)
--     - set cook_hidden_at
--   customer (auth.uid() = customer_id) may only
--     - move order_status placed -> cancelled
-- cancelled and rejected are final. decided_at, paid_at, ready_at and
-- payment_proof_rejected_at are stamped with the database's now(), whatever
-- the browser sent. Anything else is quietly put back.
-- ----------------------------------------------------------------------------
create or replace function private.orders_client_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cook boolean;
  v_customer boolean;
  v_final boolean;
  v_status_ok boolean := false;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'orders_must_use_place_order';
  end if;

  v_cook := v_uid is not null and v_uid = old.kitchen_id;
  v_customer := v_uid is not null and v_uid = old.customer_id;
  v_final := old.order_status in ('cancelled', 'rejected');

  -- Never changed by a browser.
  new.id := old.id;
  new.customer_id := old.customer_id;
  new.kitchen_id := old.kitchen_id;
  new.created_at := old.created_at;
  new.subtotal := old.subtotal;
  new.discount_total := old.discount_total;
  new.promotion_id := old.promotion_id;
  new.promotion_kind := old.promotion_kind;
  new.promotion_label := old.promotion_label;
  new.promotion_units := old.promotion_units;
  new.promotion_released_at := old.promotion_released_at;
  new.request_id := old.request_id;
  new.customer_postal_code := old.customer_postal_code;
  new.customer_lat := old.customer_lat;
  new.customer_lng := old.customer_lng;
  new.delivery_type := old.delivery_type;
  new.delivery_distance_km := old.delivery_distance_km;
  new.delivery_fee_estimate := old.delivery_fee_estimate;
  new.scheduled_for := old.scheduled_for;
  new.delivery_address_line := old.delivery_address_line;
  new.delivery_unit := old.delivery_unit;
  new.delivery_notes := old.delivery_notes;
  new.payment_due_at := old.payment_due_at;
  new.cancel_reason := old.cancel_reason;
  new.payment_proof_path := old.payment_proof_path;
  new.payment_proof_uploaded_at := old.payment_proof_uploaded_at;
  new.payment_proof_removed_at := old.payment_proof_removed_at;
  new.customer_archived_at := old.customer_archived_at;

  -- order_status
  if new.order_status is distinct from old.order_status then
    v_status_ok :=
      (v_cook and old.order_status = 'placed' and new.order_status in ('accepted', 'rejected'))
      or (v_customer and old.order_status = 'placed' and new.order_status = 'cancelled');
  end if;
  if v_status_ok then
    new.decided_at := now();
  else
    new.order_status := old.order_status;
    new.decided_at := old.decided_at;
  end if;

  -- payment_status
  if v_cook and not v_final
    and old.order_status = 'accepted'
    and old.payment_status = 'unpaid'
    and new.payment_status = 'paid' then
    new.paid_at := now();
  else
    new.payment_status := old.payment_status;
    new.paid_at := old.paid_at;
  end if;

  -- payment_proof_rejected_at (set only; submit_payment_proof clears it)
  if v_cook and not v_final
    and old.order_status = 'accepted'
    and old.payment_status = 'unpaid'
    and new.payment_proof_rejected_at is not null
    and new.payment_proof_rejected_at is distinct from old.payment_proof_rejected_at then
    new.payment_proof_rejected_at := now();
  else
    new.payment_proof_rejected_at := old.payment_proof_rejected_at;
  end if;

  -- preparation_status, forward only
  if v_cook and not v_final
    and new.preparation_status in ('not_started', 'preparing', 'ready')
    and array_position(array['not_started', 'preparing', 'ready'], new.preparation_status)
        > coalesce(array_position(array['not_started', 'preparing', 'ready'], old.preparation_status), 0) then
    if new.preparation_status = 'ready' then
      new.ready_at := now();
    else
      new.ready_at := old.ready_at;
    end if;
  else
    new.preparation_status := old.preparation_status;
    new.ready_at := old.ready_at;
  end if;

  -- cook_hidden_at: the cook's own (guard_cook_hidden_at has already run).
  if not v_cook then
    new.cook_hidden_at := old.cook_hidden_at;
  end if;

  return new;
end;
$$;

revoke all on function private.orders_client_guard() from public, anon, authenticated;

drop trigger if exists orders_client_guard on public.orders;
create trigger orders_client_guard
  before insert or update on public.orders
  for each row execute function private.orders_client_guard();

-- order_items: written only by place_order.
create or replace function private.order_items_client_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'order_items_must_use_place_order';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.order_items_client_guard() from public, anon, authenticated;

drop trigger if exists order_items_client_guard on public.order_items;
create trigger order_items_client_guard
  before insert or update or delete on public.order_items
  for each row execute function private.order_items_client_guard();


-- ############################################################################
-- HOW TO CHECK — read-only unless the line says otherwise
-- ############################################################################
--
-- 1. Switch deals on (a WRITE — only after PART 2 and a full order test):
--      update public.app_settings set deals_enabled = true, updated_at = now() where id;
--    Off again (every deal surface hides, checkout charges full price):
--      update public.app_settings set deals_enabled = false, updated_at = now() where id;
--
-- 2. Settings:
--      select * from public.app_settings;
--
-- 3. New objects exist:
--      select table_schema, table_name, table_type from information_schema.tables
--      where (table_schema, table_name) in (
--        ('public','app_settings'), ('public','promotions'), ('public','promotion_items'),
--        ('public','kitchen_deal_bans'), ('public','hero_exclusions'), ('public','active_deals'),
--        ('public','kitchen_active_deals'), ('public','kitchen_deal_badges'), ('public','hero_candidates'),
--        ('public','promotion_overview'), ('private','live_promotions'))
--      order by 1, 2;
--
-- 4. RLS on for every new table:
--      select relname, relrowsecurity from pg_class
--      where oid in ('public.app_settings'::regclass, 'public.promotions'::regclass,
--                    'public.promotion_items'::regclass, 'public.kitchen_deal_bans'::regclass,
--                    'public.hero_exclusions'::regclass);
--
-- 5. Who may run the order functions (expect: place_order and
--    compute_order_pricing false/false/true; quote_order_pricing true/true/true):
--      select f, has_function_privilege('anon', f, 'execute') as anon,
--             has_function_privilege('authenticated', f, 'execute') as authenticated,
--             has_function_privilege('service_role', f, 'execute') as service_role
--      from unnest(array[
--        'public.place_order(uuid,uuid,jsonb,jsonb,jsonb,uuid)',
--        'public.compute_order_pricing(uuid,jsonb,uuid)',
--        'public.quote_order_pricing(uuid,jsonb)']) f;
--
-- 6. Triggers on orders and order_items, in firing order:
--      select tgrelid::regclass, tgname, tgenabled from pg_trigger
--      where tgrelid in ('public.orders'::regclass, 'public.order_items'::regclass) and not tgisinternal
--      order by tgrelid, tgname;
--
-- 7. The cron jobs:
--      select jobname, schedule, command, active from cron.job where jobname like 'kb-%' order by jobname;
--
-- 8. Running deals as customers see them:
--      select * from public.kitchen_active_deals order by ends_at;
--      select * from public.kitchen_deal_badges;
--      select slide_kind, business_name, title, ends_at from public.hero_candidates;
--
-- 9. Every promotion's state, and whether its claimed count matches its orders:
--      select p.id, p.title, p.status, p.quantity_limit, p.quantity_claimed,
--             coalesce((select sum(coalesce(o.promotion_units, 1)) from public.orders o
--                       where o.promotion_id = p.id and o.promotion_released_at is null
--                         and o.order_status not in ('cancelled', 'rejected')), 0) as held_by_orders
--      from public.promotion_overview p order by p.ends_at desc;
--
-- 10. Recent orders with their deal (food_total is what the customer pays for food):
--      select id, created_at, order_status, subtotal, discount_total, food_total, delivery_fee_estimate,
--             promotion_label, promotion_units, promotion_released_at, request_id
--      from public.orders order by created_at desc limit 20;
--
-- 11. Cancelled/rejected orders still holding a deal (should be empty, or
--     cleared within 10 minutes by kb-release-promotions):
--      select id, order_status, promotion_id from public.orders
--      where promotion_id is not null and promotion_released_at is null
--        and order_status in ('cancelled', 'rejected');


-- ############################################################################
-- ROLLED-BACK TEST — places one test order through place_order, then shows
-- the guard refusing a direct insert and ignoring a direct price change.
-- Paste from BEGIN to ROLLBACK in one go. Nothing is kept: the order, its
-- items, its notifications and any queued pg_net push all roll back.
-- Needs one live kitchen with a location (kitchen_addresses) and a menu item,
-- and one customer account other than that kitchen's cook. Read the NOTICE
-- lines for the result.
-- ############################################################################
--
-- begin;
--
-- do $$
-- declare
--   v_kitchen uuid;
--   v_item uuid;
--   v_lat double precision;
--   v_lng double precision;
--   v_customer uuid;
--   v_result jsonb;
--   v_order uuid;
--   v_subtotal numeric;
-- begin
--   select k.id, m.id, ka.latitude::double precision, ka.longitude::double precision
--     into v_kitchen, v_item, v_lat, v_lng
--   from public.kitchens k
--   join public.kitchen_addresses ka on ka.kitchen_id = k.id
--   join public.menu_items m on m.kitchen_id = k.id
--   where k.is_live and not coalesce(k.is_blocked, false) and ka.latitude is not null and m.price > 0
--   limit 1;
--   select p.id into v_customer from public.profiles p where p.id <> v_kitchen limit 1;
--   raise notice 'kitchen %, item %, customer %', v_kitchen, v_item, v_customer;
--
--   -- 1. Through place_order, as the app does (the service role).
--   perform set_config('role', 'service_role', true);
--   v_result := public.place_order(
--     v_customer, v_kitchen,
--     jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 1),
--                       jsonb_build_object('menu_item_id', v_item, 'quantity', 1)),
--     jsonb_build_object('delivery_type', 'normal', 'lat', v_lat + 0.01, 'lng', v_lng + 0.01,
--                        'postal_code', '000000', 'address_line', 'ROLLED-BACK TEST'),
--     null,
--     '00000000-0000-4000-8000-000000000001');
--   raise notice 'place_order: %', v_result;
--   v_order := (v_result->>'order_id')::uuid;
--   raise notice 'same request id again: %', public.place_order(
--     v_customer, v_kitchen, jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'quantity', 5)),
--     jsonb_build_object('delivery_type', 'normal', 'lat', v_lat + 0.01, 'lng', v_lng + 0.01),
--     null, '00000000-0000-4000-8000-000000000001')->>'order_id';
--   perform set_config('role', 'postgres', true);
--   raise notice 'items (expect one line, quantity 2): %',
--     (select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id = v_order);
--
--   -- 2. A signed-in customer inserting an order directly.
--   perform set_config('request.jwt.claims', jsonb_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
--   perform set_config('role', 'authenticated', true);
--   begin
--     insert into public.orders (customer_id, kitchen_id, subtotal) values (v_customer, v_kitchen, 1);
--     raise notice 'FAIL: direct insert was allowed';
--   exception when others then
--     raise notice 'direct insert refused (expected): %', sqlerrm;
--   end;
--
--   -- 3. The same customer cancelling, and trying to change the price and
--   --    the time in the same write (RLS only lets a customer write a cancel).
--   update public.orders
--   set order_status = 'cancelled', subtotal = 0.01, delivery_fee_estimate = 0, decided_at = '2000-01-01'
--   where id = v_order;
--   perform set_config('role', 'postgres', true);
--   select o.subtotal into v_subtotal from public.orders o where o.id = v_order;
--   raise notice 'after customer edits: subtotal % (unchanged), status %, decided_at % (now)',
--     v_subtotal,
--     (select o.order_status from public.orders o where o.id = v_order),
--     (select o.decided_at from public.orders o where o.id = v_order);
-- end;
-- $$;
--
-- rollback;
