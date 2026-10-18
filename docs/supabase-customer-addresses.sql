-- ============================================================================
-- KOPI BOY 2.0 — Customer app: saved delivery addresses
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query >
-- paste this whole file > Run). Safe to re-run: IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS throughout.
--
-- Run it AFTER docs/supabase-schema.sql (profiles, orders) and after the
-- postal-code delivery quote migration (orders.customer_postal_code,
-- delivery_type, delivery_distance_km, quote_delivery()).
--
-- What it adds:
--   1. public.customer_addresses — up to 5 saved addresses per customer, at
--      most one default, readable/writable only by the customer who owns them.
--   2. orders.delivery_address_line / delivery_unit / delivery_notes — a text
--      snapshot of where the order goes. Editing or deleting a saved address
--      later never changes an order already placed.
--
-- lat/lng on a saved address are written by the Customer app's server actions
-- from the geocoded postal code, never from the browser. placeOrder() doesn't
-- trust them either: it re-geocodes the saved address's postal code at order
-- time, so a hand-edited row can't change a delivery fee.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CUSTOMER ADDRESSES
-- ----------------------------------------------------------------------------
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 20),
  postal_code text not null check (postal_code ~ '^[0-9]{6}$'),
  address_line text not null check (char_length(btrim(address_line)) between 1 and 300),
  unit text check (unit is null or char_length(unit) <= 20),
  notes text check (notes is null or char_length(notes) <= 200),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_addresses_user_idx
  on public.customer_addresses (user_id, created_at);

-- At most one default per customer.
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses (user_id)
  where is_default;

alter table public.customer_addresses enable row level security;

-- Start from zero (Supabase auto-grants new public tables), then grant back
-- exactly what's used. anon gets nothing.
revoke all on public.customer_addresses from anon, authenticated;
grant select, insert, update, delete on public.customer_addresses to authenticated;
-- service_role skips RLS but not table grants (grants have gone missing on
-- this project before), so give it the same four explicitly.
grant select, insert, update, delete on public.customer_addresses to service_role;

drop policy if exists "Customers can read their own addresses" on public.customer_addresses;
create policy "Customers can read their own addresses"
  on public.customer_addresses for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Customers can add their own addresses" on public.customer_addresses;
create policy "Customers can add their own addresses"
  on public.customer_addresses for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Customers can update their own addresses" on public.customer_addresses;
create policy "Customers can update their own addresses"
  on public.customer_addresses for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Customers can delete their own addresses" on public.customer_addresses;
create policy "Customers can delete their own addresses"
  on public.customer_addresses for delete
  to authenticated
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. RULES: 5-ADDRESS LIMIT, FIRST ADDRESS IS DEFAULT, ONE DEFAULT
-- Before insert/update:
--   * insert: refuses a 6th address (raises 'address_limit_reached', which the
--     app turns into a friendly message). The per-customer advisory lock stops
--     two simultaneous inserts both seeing 4 and both succeeding.
--   * insert: the customer's first address becomes the default.
--   * a row becoming the default clears the flag on the customer's other rows
--     first, so "Set as default" is a single update and the partial unique
--     index above never trips.
--   * keeps updated_at current.
-- ----------------------------------------------------------------------------
create or replace function public.customer_addresses_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing int;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('customer_addresses:' || new.user_id::text));
    select count(*) into existing from public.customer_addresses where user_id = new.user_id;
    if existing >= 5 then
      raise exception 'address_limit_reached' using errcode = 'P0001',
        hint = 'A customer can save up to 5 addresses.';
    end if;
    if existing = 0 then
      new.is_default := true;
    end if;
  else
    new.updated_at := now();
  end if;

  if new.is_default and (tg_op = 'INSERT' or not old.is_default) then
    update public.customer_addresses
       set is_default = false
     where user_id = new.user_id
       and id <> new.id
       and is_default;
  end if;

  return new;
end;
$$;

drop trigger if exists customer_addresses_before_write on public.customer_addresses;
create trigger customer_addresses_before_write
  before insert or update on public.customer_addresses
  for each row execute function public.customer_addresses_before_write();

-- After deleting the default, the newest remaining address takes over, so a
-- customer with saved addresses always has one preselected at checkout.
create or replace function public.customer_addresses_after_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_default then
    update public.customer_addresses
       set is_default = true
     where id = (
       select id from public.customer_addresses
        where user_id = old.user_id
        order by created_at desc
        limit 1
     );
  end if;
  return old;
end;
$$;

drop trigger if exists customer_addresses_after_delete on public.customer_addresses;
create trigger customer_addresses_after_delete
  after delete on public.customer_addresses
  for each row execute function public.customer_addresses_after_delete();

-- ----------------------------------------------------------------------------
-- 3. ORDER ADDRESS SNAPSHOT
-- Copied onto the order by placeOrder() at checkout, from the chosen saved
-- address or the freshly looked-up new one. Plain text, no link back to
-- customer_addresses, on purpose. The existing customer_postal_code,
-- customer_lat/lng, delivery_distance_km and delivery_fee_estimate columns
-- carry on as before.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists delivery_address_line text;
alter table public.orders add column if not exists delivery_unit text;
alter table public.orders add column if not exists delivery_notes text;
