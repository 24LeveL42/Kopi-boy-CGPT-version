-- ============================================================================
-- ADD-ONS, stage A1 — option groups on a dish, priced and snapshotted by
-- place_order
--
-- Run in the Supabase SQL Editor AFTER docs/supabase-promotions.sql PART 2,
-- and AFTER the Customer app that understands add-ons is live. Everything
-- below runs in ONE transaction (begin ... commit): the tables, the guards,
-- and the drop + recreate of private.promotion_eligible_lines together with
-- every function that calls it, so no function is ever left pointing at a
-- missing or changed one. If any statement fails, nothing is applied.
-- Then run:  notify pgrst, 'reload schema';
-- Safe to re-run.
--
-- BEFORE running this, run VERIFICATION (a) at the bottom of this file and
-- keep its output (see the instructions there).
--
-- What changes:
--   * menu_option_groups / menu_options: a dish's add-ons, e.g. "Extras"
--     (optional, up to 3) or "Spice level" (required, exactly 1). Cooks write
--     their own dishes' rows; anyone reads a live kitchen's.
--   * order_item_options: what was picked, with group name, option name and
--     price copied at order time. Written only by place_order. Deleting or
--     editing an option never changes an old order (option_id goes null, the
--     snapshot stays — the same rule as order_items.menu_item_id).
--   * order_items.options_price: the add-ons' price per unit of the line, so
--     a line's total is (price + options_price) * quantity. price stays the
--     dish price.
--   * p_items may carry "option_ids": [uuid, ...] per line. Missing or [] =
--     exactly the old behaviour. The same dish with different picks is a
--     separate line; identical lines still merge.
--   * Money: orders.subtotal is the gross food total INCLUDING add-ons.
--     Deals see dish prices ONLY: every deal calculation, min_spend check
--     and the discount cap use dish_subtotal (dish prices x quantity), never
--     the subtotal with add-ons. discount_total therefore only ever comes from
--     dish prices, and food_total stays subtotal - discount_total.
--   * Deal discounts are keyed by cart LINE (line_no), not by dish id, so two
--     lines of the same dish each get their own discount_amount and the lines
--     always add up to discount_total. For a cart with no add-ons each dish
--     is one line and every number is identical to before.
--
-- New errors (the Customer app maps them in src/lib/order-actions.ts):
--   invalid_option           option_ids malformed, or one option twice
--   option_not_for_item      an option that doesn't exist or isn't this dish's
--   option_sold_out          a picked option is sold out
--   option_too_many          more picks in a group than its max_picks
--   option_required_missing  a required group with no pick
--   order_too_large          the total wouldn't fit orders.subtotal
--
-- Not in this file (later stages): the cooks' save RPC
-- (save_menu_item_options, A4), the Partner order screens (A3), the
-- Customer picker (A2).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  required boolean not null default false,
  max_picks integer not null default 1 check (max_picks between 1 and 20),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists menu_option_groups_item_idx on public.menu_option_groups (menu_item_id, sort_order);

create table if not exists public.menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_option_groups(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  price numeric(6,2) not null default 0 check (price >= 0 and price <= 999),
  sold_out boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists menu_options_group_idx on public.menu_options (group_id, sort_order);

-- The snapshot. option_id is only a link back; group_name/name/price are what
-- the customer picked and paid, and never change.
create table if not exists public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  option_id uuid references public.menu_options(id) on delete set null,
  group_name text not null,
  name text not null,
  price numeric(6,2) not null check (price >= 0),
  sort_order integer not null default 0
);

create index if not exists order_item_options_item_idx on public.order_item_options (order_item_id);
create index if not exists order_item_options_option_idx on public.order_item_options (option_id) where option_id is not null;

alter table public.order_items add column if not exists options_price numeric(7,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_options_price_check' and conrelid = 'public.order_items'::regclass) then
    alter table public.order_items add constraint order_items_options_price_check check (options_price >= 0);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. RLS AND GRANTS
-- Groups/options: read like menu_items (dishes of a live kitchen); a cook
-- manages only rows hanging off their OWN dishes (checked on the new row too,
-- so a row can't be moved onto another kitchen's dish). order_item_options:
-- read like order_items; no client writes at all.
-- ----------------------------------------------------------------------------
alter table public.menu_option_groups enable row level security;
alter table public.menu_options enable row level security;
alter table public.order_item_options enable row level security;

drop policy if exists "Anyone can read option groups of a live kitchen" on public.menu_option_groups;
create policy "Anyone can read option groups of a live kitchen"
  on public.menu_option_groups for select
  using (exists (
    select 1 from public.menu_items m
    join public.kitchens k on k.id = m.kitchen_id
    where m.id = menu_option_groups.menu_item_id and k.is_live = true
  ));

drop policy if exists "Cooks can manage option groups of their own dishes" on public.menu_option_groups;
create policy "Cooks can manage option groups of their own dishes"
  on public.menu_option_groups for all
  to authenticated
  using (exists (select 1 from public.menu_items m where m.id = menu_option_groups.menu_item_id and m.kitchen_id = auth.uid()))
  with check (exists (select 1 from public.menu_items m where m.id = menu_option_groups.menu_item_id and m.kitchen_id = auth.uid()));

drop policy if exists "Admins can read every option group" on public.menu_option_groups;
create policy "Admins can read every option group"
  on public.menu_option_groups for select
  to authenticated
  using (public.has_role('admin'));

drop policy if exists "Anyone can read options of a live kitchen" on public.menu_options;
create policy "Anyone can read options of a live kitchen"
  on public.menu_options for select
  using (exists (
    select 1 from public.menu_option_groups g
    join public.menu_items m on m.id = g.menu_item_id
    join public.kitchens k on k.id = m.kitchen_id
    where g.id = menu_options.group_id and k.is_live = true
  ));

drop policy if exists "Cooks can manage options of their own dishes" on public.menu_options;
create policy "Cooks can manage options of their own dishes"
  on public.menu_options for all
  to authenticated
  using (exists (
    select 1 from public.menu_option_groups g
    join public.menu_items m on m.id = g.menu_item_id
    where g.id = menu_options.group_id and m.kitchen_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.menu_option_groups g
    join public.menu_items m on m.id = g.menu_item_id
    where g.id = menu_options.group_id and m.kitchen_id = auth.uid()
  ));

drop policy if exists "Admins can read every option" on public.menu_options;
create policy "Admins can read every option"
  on public.menu_options for select
  to authenticated
  using (public.has_role('admin'));

drop policy if exists "Customers can read options on their own orders" on public.order_item_options;
create policy "Customers can read options on their own orders"
  on public.order_item_options for select
  to authenticated
  using (exists (
    select 1 from public.order_items i
    join public.orders o on o.id = i.order_id
    where i.id = order_item_options.order_item_id and o.customer_id = auth.uid()
  ));

drop policy if exists "Cooks can read options on orders placed at their kitchen" on public.order_item_options;
create policy "Cooks can read options on orders placed at their kitchen"
  on public.order_item_options for select
  to authenticated
  using (exists (
    select 1 from public.order_items i
    join public.orders o on o.id = i.order_id
    where i.id = order_item_options.order_item_id and o.kitchen_id = auth.uid()
  ));

drop policy if exists "Admins can read every order item option" on public.order_item_options;
create policy "Admins can read every order item option"
  on public.order_item_options for select
  to authenticated
  using (public.has_role('admin'));

-- Supabase's default privileges grant everything on new tables; start from
-- nothing and grant only what the policies above are for.
revoke all on public.menu_option_groups, public.menu_options, public.order_item_options from anon, authenticated;
grant select on public.menu_option_groups, public.menu_options to anon, authenticated;
grant insert, update, delete on public.menu_option_groups, public.menu_options to authenticated;
grant select on public.order_item_options to authenticated;

-- order_item_options: written only by place_order. Same guard as
-- order_items_client_guard. Cascades and the option_id set-null run as the
-- table owner, so they pass.
create or replace function private.order_item_options_client_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'order_item_options_must_use_place_order';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.order_item_options_client_guard() from public, anon, authenticated;

drop trigger if exists order_item_options_client_guard on public.order_item_options;
create trigger order_item_options_client_guard
  before insert or update or delete on public.order_item_options
  for each row execute function private.order_item_options_client_guard();

-- ----------------------------------------------------------------------------
-- 3. CART ITEMS — validate and merge (replaces promotions 2.2)
-- [{ "menu_item_id": uuid, "quantity": 1..99, "option_ids": [uuid, ...] }]
-- -> the same shape, option_ids always present (sorted, possibly []), lines
-- merged when dish AND picks are the same (first position kept). Raises
-- empty_cart, invalid_item, invalid_quantity or invalid_option.
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
  v_opts jsonb;
  v_opt jsonb;
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

    v_opts := v_item->'option_ids';
    if v_opts is not null and jsonb_typeof(v_opts) <> 'null' then
      if jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) > 50 then
        raise exception 'invalid_option';
      end if;
      for v_opt in select e from jsonb_array_elements(v_opts) e loop
        if jsonb_typeof(v_opt) <> 'string'
          or (v_opt #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'invalid_option';
        end if;
      end loop;
      -- No quantity per option: the same option twice on one line is refused.
      if (select count(distinct lower(e #>> '{}')) from jsonb_array_elements(v_opts) e) <> jsonb_array_length(v_opts) then
        raise exception 'invalid_option';
      end if;
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object('menu_item_id', id, 'quantity', qty, 'option_ids', opts) order by first_pos)
    into v_result
  from (
    select id, opts, sum(qty) as qty, min(pos) as first_pos
    from (
      select lower(e->>'menu_item_id')::uuid as id,
             (e->>'quantity')::integer as qty,
             pos,
             coalesce((
               select jsonb_agg(o order by o)
               from (
                 select lower(x #>> '{}')::uuid as o
                 from jsonb_array_elements(case when jsonb_typeof(e->'option_ids') = 'array' then e->'option_ids' else '[]'::jsonb end) x
               ) s
             ), '[]'::jsonb) as opts
      from jsonb_array_elements(p_items) with ordinality t(e, pos)
    ) l
    group by id, opts
  ) merged;

  if exists (select 1 from jsonb_array_elements(v_result) e where (e->>'quantity')::integer > 99) then
    raise exception 'invalid_quantity';
  end if;
  return v_result;
end;
$$;

revoke all on function private.normalize_order_items(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. DEAL DISCOUNTS BY LINE (replaces promotions 2.3)
-- promotion_eligible_lines gains line_no in its result, so it is dropped and
-- recreated; its only caller, promotion_discounts, is recreated right after,
-- in this same transaction. p_lines carry the DISH price only: deals never
-- see add-ons. Ties are broken by menu_item_id and then line_no, so a cart
-- with one line per dish orders exactly as before.
-- ----------------------------------------------------------------------------
drop function if exists private.promotion_eligible_lines(uuid, jsonb);

create function private.promotion_eligible_lines(p_promotion_id uuid, p_lines jsonb)
returns table (line_no integer, menu_item_id uuid, price numeric, quantity integer)
language sql
stable
set search_path = ''
as $$
  select (e->>'line_no')::integer, (e->>'menu_item_id')::uuid, (e->>'price')::numeric, (e->>'quantity')::integer
  from jsonb_array_elements(p_lines) e
  where not exists (select 1 from public.promotion_items pi where pi.promotion_id = p_promotion_id)
     or exists (
       select 1 from public.promotion_items pi
       where pi.promotion_id = p_promotion_id and pi.menu_item_id = (e->>'menu_item_id')::uuid
     );
$$;

revoke all on function private.promotion_eligible_lines(uuid, jsonb) from public, anon, authenticated;

-- p_lines: [{ line_no, menu_item_id, name, price, quantity }], price = dish
-- price from menu_items. p_subtotal: the DISH subtotal (no add-ons).
-- Returns { "lines": { "<line_no>": discount, ... }, "units": n } with every
-- amount rounded to 2 dp and never more than its line. Empty lines = the
-- deal doesn't apply.
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
  v_free_line integer;
begin
  if p.kind = 'free_item' then
    -- One unit free: the first line of that dish (its add-ons are still paid).
    select (e->>'line_no')::integer, (e->>'price')::numeric into v_free_line, v_free_price
    from jsonb_array_elements(p_lines) e
    where (e->>'menu_item_id')::uuid = p.free_item_id
    order by (e->>'line_no')::integer
    limit 1;
    if v_free_price is null or v_free_price <= 0 then
      return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
    end if;
    if p.min_spend is not null and p_subtotal - v_free_price < p.min_spend then
      return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
    end if;
    return jsonb_build_object('lines', jsonb_build_object(v_free_line::text, round(v_free_price, 2)), 'units', 1);
  end if;

  if p.kind = 'min_spend' and p.min_spend is null then
    return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
  end if;
  if p.min_spend is not null and p_subtotal < p.min_spend then
    return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
  end if;

  if p.kind in ('percent_off', 'amount_off', 'min_spend') then
    if p.percent_off is not null and p.kind <> 'amount_off' then
      select coalesce(jsonb_object_agg(line_no::text, d) filter (where d > 0), '{}'::jsonb) into v_lines
      from (
        select line_no, round(price * quantity * p.percent_off / 100, 2) as d
        from private.promotion_eligible_lines(p.id, p_lines)
      ) s;
    elsif p.amount_off is not null and p.kind <> 'percent_off' then
      select coalesce(sum(price * quantity), 0) into v_eligible from private.promotion_eligible_lines(p.id, p_lines);
      if v_eligible <= 0 then
        return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
      end if;
      v_off := least(p.amount_off, v_eligible);
      -- Spread across lines by value; the biggest line takes the rounding cents.
      select coalesce(jsonb_object_agg(line_no::text, d) filter (where d > 0), '{}'::jsonb) into v_lines
      from (
        select line_no,
               least(sh.t, greatest(0, sh.share + case when sh.rn = 1 then v_off - sum(sh.share) over () else 0 end)) as d
        from (
          select line_no,
                 price * quantity as t,
                 round(v_off * price * quantity / v_eligible, 2) as share,
                 row_number() over (order by price * quantity desc, menu_item_id, line_no) as rn
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
    select coalesce(jsonb_object_agg(line_no::text, d), '{}'::jsonb) into v_lines
    from (
      select line_no, round(sum(price), 2) as d
      from (
        select l.line_no, l.price, row_number() over (order by l.price, l.menu_item_id, l.line_no) as rn
        from private.promotion_eligible_lines(p.id, p_lines) l
        cross join lateral generate_series(1, l.quantity)
      ) u
      where rn <= v_free
      group by line_no
    ) s
    where d > 0;
    return jsonb_build_object('lines', v_lines, 'units', 1);
  end if;

  if p.kind in ('limited_qty', 'flash') then
    v_remaining := case when p.quantity_limit is null then 99 * 100 else greatest(p.quantity_limit - p.quantity_claimed, 0) end;
    -- The most expensive eligible units first, up to what's left.
    select coalesce(jsonb_object_agg(line_no::text, d), '{}'::jsonb), coalesce(sum(n), 0)::integer
      into v_lines, v_units
    from (
      select line_no, round(sum(unit_off), 2) as d, count(*) as n
      from (
        select l.line_no,
               case
                 when p.deal_price is not null then greatest(l.price - p.deal_price, 0)
                 when p.percent_off is not null then round(l.price * p.percent_off / 100, 2)
                 when p.amount_off is not null then least(p.amount_off, l.price)
                 else 0
               end as unit_off,
               row_number() over (order by l.price desc, l.menu_item_id, l.line_no) as rn
        from private.promotion_eligible_lines(p.id, p_lines) l
        cross join lateral generate_series(1, l.quantity)
      ) u
      where rn <= v_remaining and unit_off > 0
      group by line_no
    ) s
    where d > 0;
    return jsonb_build_object('lines', v_lines, 'units', v_units);
  end if;

  return jsonb_build_object('lines', '{}'::jsonb, 'units', 0);
end;
$$;

revoke all on function private.promotion_discounts(public.promotions, jsonb, numeric) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. COMPUTE ORDER PRICING (replaces promotions 2.4; same signature/grants)
-- Dish prices from menu_items, add-on prices from menu_options; every item
-- must belong to the kitchen and every option to its line's dish.
--   subtotal         = dish_subtotal + options_subtotal (gross food total)
--   dish_subtotal    = dish price x quantity — the ONLY figure deals see
--                      (min_spend checks and the discount cap included)
--   options_subtotal = add-on prices x quantity
--   discount_total   = the best single deal, from dish prices only
--   food_total       = subtotal - discount_total
-- Lines: [{ line_no, menu_item_id, name, price (dish), quantity,
--           options_price (per unit), options: [{ option_id, group_name,
--           name, price, sort_order }], discount_amount }]
-- discount_amount is looked up by line_no, so the lines always add up to
-- discount_total.
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
  v_item jsonb;
  v_pos bigint;
  v_menu record;
  v_ids uuid[];
  v_opts jsonb;
  v_opts_price numeric;
  v_lines jsonb := '[]'::jsonb;
  v_dish_subtotal numeric := 0;
  v_options_subtotal numeric := 0;
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

  for v_item, v_pos in select e, pos from jsonb_array_elements(v_items) with ordinality t(e, pos) loop
    select m.id, m.name, m.price into v_menu
    from public.menu_items m
    where m.id = (v_item->>'menu_item_id')::uuid and m.kitchen_id = p_kitchen_id;
    if not found then
      raise exception 'item_unavailable';
    end if;

    v_ids := array(select (x #>> '{}')::uuid from jsonb_array_elements(v_item->'option_ids') x);

    if (
      select count(*) from public.menu_options o
      join public.menu_option_groups g on g.id = o.group_id
      where o.id = any(v_ids) and g.menu_item_id = v_menu.id
    ) <> cardinality(v_ids) then
      raise exception 'option_not_for_item';
    end if;
    if exists (select 1 from public.menu_options o where o.id = any(v_ids) and o.sold_out) then
      raise exception 'option_sold_out';
    end if;
    if exists (
      select 1 from public.menu_option_groups g
      where g.menu_item_id = v_menu.id
        and (select count(*) from public.menu_options o where o.group_id = g.id and o.id = any(v_ids)) > g.max_picks
    ) then
      raise exception 'option_too_many';
    end if;
    if exists (
      select 1 from public.menu_option_groups g
      where g.menu_item_id = v_menu.id
        and g.required
        and not exists (select 1 from public.menu_options o where o.group_id = g.id and o.id = any(v_ids))
    ) then
      raise exception 'option_required_missing';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'option_id', s.id, 'group_name', s.group_name, 'name', s.name, 'price', s.price, 'sort_order', s.n
           ) order by s.n), '[]'::jsonb),
           coalesce(sum(s.price), 0)
      into v_opts, v_opts_price
    from (
      select o.id, g.name as group_name, o.name, o.price,
             row_number() over (order by g.sort_order, g.id, o.sort_order, o.id) as n
      from public.menu_options o
      join public.menu_option_groups g on g.id = o.group_id
      where o.id = any(v_ids)
    ) s;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_pos,
      'menu_item_id', v_menu.id,
      'name', v_menu.name,
      'price', v_menu.price,
      'quantity', (v_item->>'quantity')::integer,
      'options_price', v_opts_price,
      'options', v_opts
    ));
    v_dish_subtotal := v_dish_subtotal + v_menu.price * (v_item->>'quantity')::integer;
    v_options_subtotal := v_options_subtotal + v_opts_price * (v_item->>'quantity')::integer;
  end loop;

  v_dish_subtotal := round(v_dish_subtotal, 2);
  v_options_subtotal := round(v_options_subtotal, 2);
  v_subtotal := v_dish_subtotal + v_options_subtotal;

  if v_dish_subtotal <= 0 then
    raise exception 'item_unavailable';
  end if;
  if v_subtotal > 99999.99 then
    raise exception 'order_too_large';
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

    -- Deals see dish prices only: dish lines and the dish subtotal.
    v_result := private.promotion_discounts(v_promo, v_lines, v_dish_subtotal);
    select coalesce(sum(value::numeric), 0) into v_total from jsonb_each_text(v_result->'lines');
    v_total := least(v_total, v_dish_subtotal);
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
    'dish_subtotal', v_dish_subtotal,
    'options_subtotal', v_options_subtotal,
    'discount_total', round(v_best_total, 2),
    'food_total', round(v_subtotal - v_best_total, 2),
    'promotion_id', case when v_best_total > 0 then v_best.id end,
    'promotion_kind', case when v_best_total > 0 then v_best.kind end,
    'promotion_label', case when v_best_total > 0 then v_best.title end,
    'promotion_units', case when v_best_total > 0 then v_best_units end,
    'lines', (
      select jsonb_agg(l || jsonb_build_object('discount_amount', coalesce((v_best_lines->>(l->>'line_no'))::numeric, 0)) order by (l->>'line_no')::integer)
      from jsonb_array_elements(v_lines) l
    )
  );
end;
$$;

revoke execute on function public.compute_order_pricing(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.compute_order_pricing(uuid, jsonb, uuid) to service_role;

-- public.quote_order_pricing (promotions 2.5) is NOT changed: it calls
-- compute_order_pricing by name, so it uses the new one, and it now also
-- returns dish_subtotal and options_subtotal.

-- ----------------------------------------------------------------------------
-- 6. PLACE ORDER (replaces promotions 2.6; same signature/grants)
-- Changes from 2.6: the dishes' option groups and options are locked with
-- the menu items, so an option can't sell out or change price mid-order;
-- each order_items row gets options_price, and its picks are copied into
-- order_item_options. Everything else is unchanged.
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
  v_line jsonb;
  v_order_item_id uuid;
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

  perform 1 from public.menu_option_groups g
  where g.menu_item_id in (select (e->>'menu_item_id')::uuid from jsonb_array_elements(v_items) e)
  order by g.id
  for share;

  perform 1 from public.menu_options o
  where o.group_id in (
    select g.id from public.menu_option_groups g
    where g.menu_item_id in (select (e->>'menu_item_id')::uuid from jsonb_array_elements(v_items) e)
  )
  order by o.id
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

  for v_line in select l from jsonb_array_elements(v_pricing->'lines') l order by (l->>'line_no')::integer loop
    insert into public.order_items (order_id, menu_item_id, name, price, quantity, discount_amount, options_price)
    values (
      v_order_id,
      (v_line->>'menu_item_id')::uuid,
      v_line->>'name',
      (v_line->>'price')::numeric,
      (v_line->>'quantity')::integer,
      (v_line->>'discount_amount')::numeric,
      (v_line->>'options_price')::numeric
    )
    returning id into v_order_item_id;

    insert into public.order_item_options (order_item_id, option_id, group_name, name, price, sort_order)
    select v_order_item_id, (o->>'option_id')::uuid, o->>'group_name', o->>'name', (o->>'price')::numeric, (o->>'sort_order')::integer
    from jsonb_array_elements(v_line->'options') o;
  end loop;

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

commit;


-- ############################################################################
-- VERIFICATION — READ-ONLY. Every statement below is a SELECT; nothing is
-- written. They are commented out so running this whole file never runs
-- them: copy one block (without the leading "-- ") into a NEW SQL Editor tab.
-- ############################################################################

-- ----------------------------------------------------------------------------
-- (a) NO-ADD-ON PRICING IS UNCHANGED
-- For up to 20 live kitchens (lowest ids first): a cart of the kitchen's
-- first 3 dishes (by id) with quantities 1, 2, 3, priced by
-- compute_order_pricing with no customer. Only fields that existed before
-- this migration are shown, so the query runs on both versions.
--
-- HOW TO RUN IT, BEFORE AND AFTER:
--   1. BEFORE running this file: open a new SQL Editor tab, paste the query,
--      Run, and download the result (Export > CSV) or copy the fingerprint
--      row's value somewhere.
--   2. Run this file (the begin ... commit part), then
--      notify pgrst, 'reload schema';
--   3. Straight away, run the same query again in the same way.
--   4. Compare: every row must match. The quickest check is the LAST row,
--      kitchen_id = 'FINGERPRINT': its value must be identical before and
--      after.
--   Run "after" straight away, before any cook has added option groups: a
--   dish with a REQUIRED group can't be priced without a pick, so once one
--   exists this query stops with option_required_missing (that's correct
--   behaviour, not a pricing change).
--   Do 1-3 within a few minutes, off-peak. A deal that starts or ends, a
--   menu price edit, or a flash/limited deal selling portions in between
--   changes the numbers legitimately; if they differ, run step 1's query
--   once more right away and see whether that also moved.
--
-- with kitchen_carts as (
--   select k.id as kitchen_id,
--          (select jsonb_agg(jsonb_build_object('menu_item_id', d.id, 'quantity', d.n) order by d.id)
--           from (select m.id, row_number() over (order by m.id)::integer as n
--                 from public.menu_items m where m.kitchen_id = k.id order by m.id limit 3) d) as cart
--   from public.kitchens k
--   where k.is_live and not coalesce(k.is_blocked, false)
--     and exists (select 1 from public.menu_items m where m.kitchen_id = k.id)
--   order by k.id
--   limit 20
-- ),
-- priced as (
--   select c.kitchen_id::text as kitchen_id, public.compute_order_pricing(c.kitchen_id, c.cart, null) as r
--   from kitchen_carts c
-- ),
-- results as (
--   select kitchen_id,
--          jsonb_build_object(
--            'subtotal', (r->>'subtotal')::numeric,
--            'discount_total', (r->>'discount_total')::numeric,
--            'food_total', (r->>'food_total')::numeric,
--            'promotion_id', r->>'promotion_id',
--            'promotion_kind', r->>'promotion_kind',
--            'promotion_units', r->>'promotion_units',
--            'lines', (select jsonb_agg(jsonb_build_object(
--                        'menu_item_id', l->>'menu_item_id',
--                        'price', (l->>'price')::numeric,
--                        'quantity', (l->>'quantity')::integer,
--                        'discount_amount', (l->>'discount_amount')::numeric
--                      ) order by l->>'menu_item_id')
--                      from jsonb_array_elements(r->'lines') l)
--          )::text as pricing
--   from priced
-- )
-- select kitchen_id, pricing
-- from (
--   select 0 as sort_key, kitchen_id, pricing from results
--   union all
--   select 1, 'FINGERPRINT', md5(coalesce(string_agg(kitchen_id || '=' || pricing, '|' order by kitchen_id), ''))
--   from results
-- ) out
-- order by sort_key, kitchen_id;

-- ----------------------------------------------------------------------------
-- (b) SECURITY DEFINER, search_path and EXECUTE on the functions
-- Expected:
--   public.place_order, public.compute_order_pricing:
--     secdef = true, config = {search_path=""}, anon = false,
--     authenticated = false, service_role = true
--   public.quote_order_pricing: secdef = true, anon = true,
--     authenticated = true, service_role = true (unchanged display-only quote)
--   private.normalize_order_items, private.promotion_eligible_lines,
--   private.promotion_discounts, private.order_item_options_client_guard:
--     secdef = false, anon = false, authenticated = false
--
-- select n.nspname || '.' || p.proname as function,
--        p.prosecdef as secdef,
--        p.proconfig as config,
--        has_function_privilege('anon', p.oid, 'execute') as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--        has_function_privilege('service_role', p.oid, 'execute') as service_role
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where (n.nspname = 'public' and p.proname in ('place_order', 'compute_order_pricing', 'quote_order_pricing'))
--    or (n.nspname = 'private' and p.proname in ('normalize_order_items', 'promotion_eligible_lines', 'promotion_discounts', 'order_item_options_client_guard'))
-- order by 1;
--
-- Tables: RLS on, and what each role may do. Expected:
--   menu_option_groups, menu_options: rls = true; anon select only;
--     authenticated select/insert/update/delete (RLS limits writes to the
--     cook's own dishes)
--   order_item_options: rls = true; anon nothing; authenticated select only
--
-- select c.relname as table_name,
--        c.relrowsecurity as rls,
--        has_table_privilege('anon', c.oid, 'select') as anon_select,
--        has_table_privilege('anon', c.oid, 'insert') as anon_insert,
--        has_table_privilege('anon', c.oid, 'update') as anon_update,
--        has_table_privilege('anon', c.oid, 'delete') as anon_delete,
--        has_table_privilege('authenticated', c.oid, 'select') as auth_select,
--        has_table_privilege('authenticated', c.oid, 'insert') as auth_insert,
--        has_table_privilege('authenticated', c.oid, 'update') as auth_update,
--        has_table_privilege('authenticated', c.oid, 'delete') as auth_delete
-- from pg_class c
-- where c.oid in ('public.menu_option_groups'::regclass, 'public.menu_options'::regclass, 'public.order_item_options'::regclass)
-- order by 1;
--
-- Policies (expect 3 per table) and the guard trigger (expect 1 row):
--
-- select tablename, policyname, cmd, roles from pg_policies
-- where schemaname = 'public' and tablename in ('menu_option_groups', 'menu_options', 'order_item_options')
-- order by tablename, policyname;
--
-- select tgname from pg_trigger
-- where tgrelid = 'public.order_item_options'::regclass and not tgisinternal;

-- ----------------------------------------------------------------------------
-- (c) ANON CAN'T PRICE, PLACE OR WRITE
-- One row; every column must be false.
--
-- select
--   has_function_privilege('anon', 'public.compute_order_pricing(uuid, jsonb, uuid)', 'execute') as anon_compute_order_pricing,
--   has_function_privilege('anon', 'public.place_order(uuid, uuid, jsonb, jsonb, jsonb, uuid)', 'execute') as anon_place_order,
--   has_table_privilege('anon', 'public.menu_option_groups', 'insert,update,delete') as anon_write_option_groups,
--   has_table_privilege('anon', 'public.menu_options', 'insert,update,delete') as anon_write_options,
--   has_table_privilege('anon', 'public.order_item_options', 'insert,update,delete') as anon_write_order_item_options,
--   has_table_privilege('anon', 'public.order_items', 'insert,update,delete') as anon_write_order_items,
--   has_table_privilege('authenticated', 'public.order_item_options', 'insert,update,delete') as auth_write_order_item_options;
