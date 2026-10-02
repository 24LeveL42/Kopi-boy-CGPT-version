-- ============================================================================
-- KOPI BOY 2.0 — Feature #002: Auth + Roles
-- Run this ONCE in your Supabase project's SQL Editor (Dashboard > SQL Editor
-- > New query > paste this whole file > Run).
--
-- Safe to re-run: every statement below is idempotent (CREATE TABLE IF NOT
-- EXISTS, DROP POLICY/TRIGGER IF EXISTS before CREATE, CREATE OR REPLACE for
-- functions, IF EXISTS/IF NOT EXISTS on ALTER statements). Running this whole
-- file again on a database that already has some or all of it is safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES
-- One row per authenticated user. Created automatically on signup via the
-- trigger at the bottom of this file — never insert into this table directly
-- from the app.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'cook', 'rider', 'admin')),
  full_name text,
  phone text,
  -- Admin on/off switch for cooks and riders (section 16/21 of the handover
  -- doc — "temporary block", "suspend/reinstate"). Customers and admins are
  -- always active; this only matters for cook/rider rows.
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ----------------------------------------------------------------------------
-- 1a. ROLE-CHECK HELPER (avoids RLS self-recursion)
-- A policy on public.profiles must never check the caller's role with a
-- plain `exists (select 1 from public.profiles ...)` subquery — Postgres has
-- to evaluate profiles' own policies to run that subquery, which includes
-- this same check, forever: "infinite recursion detected in policy for
-- relation 'profiles'". Every table's admin/role-gated policies below call
-- this function instead. SECURITY DEFINER makes it run as its owner (the
-- table owner), which bypasses RLS on profiles entirely, so the lookup never
-- re-triggers the policy that's calling it.
-- ----------------------------------------------------------------------------
create or replace function public.has_role(target_role text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = target_role
  );
$$;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own row, but a trigger (below) silently protects
-- role/is_active from being changed by anyone except an admin — otherwise
-- this policy alone would let a user grant themselves admin access.
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Admins can read every profile" on public.profiles;
create policy "Admins can read every profile"
  on public.profiles for select
  using (public.has_role('admin'));

drop policy if exists "Admins can update every profile" on public.profiles;
create policy "Admins can update every profile"
  on public.profiles for update
  using (public.has_role('admin'));

-- ----------------------------------------------------------------------------
-- 2. COOK APPLICATIONS
-- Section 20 of the handover doc: register -> submit -> review -> approve/reject.
-- ----------------------------------------------------------------------------
create table if not exists public.cook_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_type text, -- e.g. "Home Cook", "Hawker", "Bakery", "Small Business"
  description text,
  neighbourhood text,
  paynow_uen text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.cook_applications enable row level security;

drop policy if exists "Applicants can read their own cook application" on public.cook_applications;
create policy "Applicants can read their own cook application"
  on public.cook_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Applicants can submit a cook application" on public.cook_applications;
create policy "Applicants can submit a cook application"
  on public.cook_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read every cook application" on public.cook_applications;
create policy "Admins can read every cook application"
  on public.cook_applications for select
  using (public.has_role('admin'));

drop policy if exists "Admins can update every cook application" on public.cook_applications;
create policy "Admins can update every cook application"
  on public.cook_applications for update
  using (public.has_role('admin'));

-- ----------------------------------------------------------------------------
-- 3. RIDER APPLICATIONS
-- Section 10/21: free registration, but must be approved before accepting
-- deliveries.
-- ----------------------------------------------------------------------------
create table if not exists public.rider_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_type text, -- e.g. "Bicycle", "Motorcycle", "Car"
  license_plate text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.rider_applications enable row level security;

drop policy if exists "Applicants can read their own rider application" on public.rider_applications;
create policy "Applicants can read their own rider application"
  on public.rider_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Applicants can submit a rider application" on public.rider_applications;
create policy "Applicants can submit a rider application"
  on public.rider_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read every rider application" on public.rider_applications;
create policy "Admins can read every rider application"
  on public.rider_applications for select
  using (public.has_role('admin'));

drop policy if exists "Admins can update every rider application" on public.rider_applications;
create policy "Admins can update every rider application"
  on public.rider_applications for update
  using (public.has_role('admin'));

-- ----------------------------------------------------------------------------
-- 4. AUTO-CREATE A PROFILE ROW ON SIGNUP
-- Runs every time someone signs up (Google or email OTP). Defaults everyone
-- to role = 'customer' — cooks/riders upgrade their own role only via an
-- approved application (handled in application-approval logic later, Feature
-- #003), never by editing their own profile row directly.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. PROTECT role AND is_active FROM SELF-EDITING
-- The "Users can update their own profile" policy above allows a user to
-- update their own row (needed for e.g. changing their name/phone) — but
-- without this trigger, that same policy would let a user set their own
-- role to 'admin' or flip their own is_active flag. This trigger silently
-- reverts those two columns to their previous value unless the person
-- making the change is already an admin.
-- ----------------------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists before_profile_update on public.profiles;
create trigger before_profile_update
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();


-- ============================================================================
-- KOPI BOY 2.0 — Feature #003: Merchant Onboarding (Kitchen + Menu)
-- Run this ONCE, after the Feature #002 script above, in the same Supabase
-- project's SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6. KITCHENS
-- One row per approved cook — the merchant-facing profile shown in the
-- Customer app marketplace. Created/edited by the cook themselves via the
-- Partner app's kitchen setup screen, not by HQ. id = the cook's own
-- profiles.id (one kitchen per cook).
-- ----------------------------------------------------------------------------
create table if not exists public.kitchens (
  id uuid primary key references public.profiles(id) on delete cascade,
  business_name text not null,
  category text not null check (category in ('home-cook', 'hawker', 'bakery', 'bulk-orders', 'drinks')),
  cuisine_type text not null check (cuisine_type in ('chinese', 'halal', 'indian', 'western')),
  neighbourhood text not null,
  description text,
  hero_image text, -- optional per the handover doc ("a food photo is optional"); Customer app falls back to a category image when null
  is_live boolean not null default false, -- flips true once the cook has saved at least one menu item (enforced in app logic, not here)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kitchens enable row level security;

drop policy if exists "Cooks can read their own kitchen" on public.kitchens;
create policy "Cooks can read their own kitchen"
  on public.kitchens for select
  using (auth.uid() = id);

drop policy if exists "Cooks can insert their own kitchen" on public.kitchens;
create policy "Cooks can insert their own kitchen"
  on public.kitchens for insert
  with check (auth.uid() = id and public.has_role('cook'));

drop policy if exists "Cooks can update their own kitchen" on public.kitchens;
create policy "Cooks can update their own kitchen"
  on public.kitchens for update
  using (auth.uid() = id);

drop policy if exists "Anyone can read live kitchens" on public.kitchens;
create policy "Anyone can read live kitchens"
  on public.kitchens for select
  using (is_live = true);

drop policy if exists "Admins can read every kitchen" on public.kitchens;
create policy "Admins can read every kitchen"
  on public.kitchens for select
  using (public.has_role('admin'));

-- ----------------------------------------------------------------------------
-- 7. MENU ITEMS
-- Section: "menu items and price tags are mandatory; a food photo is
-- optional." One row per dish. The Partner app replaces all of a kitchen's
-- rows on every save (see KitchenSetupForm) rather than diffing — simplest
-- correct approach for this feature's scope.
-- ----------------------------------------------------------------------------
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  name text not null,
  price numeric(6,2) not null check (price > 0),
  photo_url text,
  created_at timestamptz not null default now()
);

alter table public.menu_items enable row level security;

drop policy if exists "Cooks can manage their own menu items" on public.menu_items;
create policy "Cooks can manage their own menu items"
  on public.menu_items for all
  using (auth.uid() = kitchen_id)
  with check (auth.uid() = kitchen_id);

drop policy if exists "Anyone can read menu items of a live kitchen" on public.menu_items;
create policy "Anyone can read menu items of a live kitchen"
  on public.menu_items for select
  using (exists (select 1 from public.kitchens k where k.id = menu_items.kitchen_id and k.is_live = true));

-- ----------------------------------------------------------------------------
-- 8. KEEP updated_at CURRENT ON KITCHENS
-- ----------------------------------------------------------------------------
create or replace function public.touch_kitchen_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists before_kitchen_update on public.kitchens;
create trigger before_kitchen_update
  before update on public.kitchens
  for each row execute function public.touch_kitchen_updated_at();


-- ============================================================================
-- KOPI BOY 2.0 — Picker role (optional pickup helper for riders)
-- Run this ONCE, after the Feature #002 and #003 scripts above, in the same
-- Supabase project's SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 9. ALLOW 'picker' AS A PROFILE ROLE
-- Postgres won't let you edit a check constraint in place, so it's
-- drop-and-recreate. If this fails because your constraint has a different
-- auto-generated name, find it first with:
--   select conname from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c';
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('customer', 'cook', 'rider', 'picker', 'admin'));

-- ----------------------------------------------------------------------------
-- 10. PICKER APPLICATIONS
-- Same register -> submit -> review -> approve/reject pattern as cook/rider
-- applications. Deliberately minimal fields — this role is meant for
-- students/anyone nearby wanting casual pocket money, not a vetted fleet.
-- ----------------------------------------------------------------------------
create table if not exists public.picker_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note text, -- optional: why they want to pick up orders, anything relevant
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.picker_applications enable row level security;

drop policy if exists "Applicants can read their own picker application" on public.picker_applications;
create policy "Applicants can read their own picker application"
  on public.picker_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Applicants can submit a picker application" on public.picker_applications;
create policy "Applicants can submit a picker application"
  on public.picker_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read every picker application" on public.picker_applications;
create policy "Admins can read every picker application"
  on public.picker_applications for select
  using (public.has_role('admin'));

drop policy if exists "Admins can update every picker application" on public.picker_applications;
create policy "Admins can update every picker application"
  on public.picker_applications for update
  using (public.has_role('admin'));

-- ----------------------------------------------------------------------------
-- 11. PICKUP REQUESTS
-- The rider-initiated, picker-fulfilled handshake described in the picker
-- workflow: rider requests a picker for a specific kitchen pickup -> any
-- approved picker can accept -> picker collects from the cook -> picker
-- hands off to the rider and marks it complete. Payment (rider pays picker)
-- happens off-platform, same as every other money leg in Kopi Boy —
-- suggested_fee is a default the app shows, not an enforced amount.
--
-- NOTE: not yet linked to a real orders/deliveries table since #005/#006/#008
-- haven't shipped. kitchen_id is enough to make the full accept/collect/
-- handoff loop testable now; link it to a real delivery_id once that table
-- exists.
-- ----------------------------------------------------------------------------
create table if not exists public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  picker_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'accepted', 'completed', 'cancelled')),
  suggested_fee numeric(5,2) not null default 2.00,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);

alter table public.pickup_requests enable row level security;

drop policy if exists "Riders can create their own pickup requests" on public.pickup_requests;
create policy "Riders can create their own pickup requests"
  on public.pickup_requests for insert
  with check (auth.uid() = rider_id);

drop policy if exists "Riders can read their own pickup requests" on public.pickup_requests;
create policy "Riders can read their own pickup requests"
  on public.pickup_requests for select
  using (auth.uid() = rider_id);

drop policy if exists "Riders can cancel their own open pickup requests" on public.pickup_requests;
create policy "Riders can cancel their own open pickup requests"
  on public.pickup_requests for update
  using (auth.uid() = rider_id and status = 'open')
  with check (auth.uid() = rider_id and status = 'cancelled');

drop policy if exists "Pickers can read open pickup requests" on public.pickup_requests;
create policy "Pickers can read open pickup requests"
  on public.pickup_requests for select
  using (
    status = 'open'
    and public.has_role('picker')
  );

drop policy if exists "Pickers can read their assigned pickup requests" on public.pickup_requests;
create policy "Pickers can read their assigned pickup requests"
  on public.pickup_requests for select
  using (auth.uid() = picker_id);

drop policy if exists "Pickers can accept an open pickup request" on public.pickup_requests;
create policy "Pickers can accept an open pickup request"
  on public.pickup_requests for update
  using (
    status = 'open'
    and public.has_role('picker')
  )
  with check (picker_id = auth.uid() and status = 'accepted');

drop policy if exists "Pickers can complete their assigned pickup request" on public.pickup_requests;
create policy "Pickers can complete their assigned pickup request"
  on public.pickup_requests for update
  using (auth.uid() = picker_id)
  with check (auth.uid() = picker_id);

drop policy if exists "Admins can read every pickup request" on public.pickup_requests;
create policy "Admins can read every pickup request"
  on public.pickup_requests for select
  using (public.has_role('admin'));

drop policy if exists "Admins can update every pickup request" on public.pickup_requests;
create policy "Admins can update every pickup request"
  on public.pickup_requests for update
  using (public.has_role('admin'));


-- ============================================================================
-- KOPI BOY 2.0 — Feature #005: Cart + Order Creation
-- Run this ONCE, after the Feature #002/#003 and picker-role scripts above,
-- in the same Supabase project's SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 12. ORDERS
-- One row per placed order. The app's checkout server action re-fetches real
-- menu_items prices and computes subtotal itself — never trust a
-- client-supplied total. No delivery_fee column yet — that's #007;
-- subtotal is the whole total until then.
--
-- order_status and payment_status are deliberately separate columns, per
-- the locked business rule that order/payment/preparation/delivery/incident
-- are separate status fields, not one combined enum (see docs/feature-001.md).
-- Feature #006 (cook accept/reject + PayNow) is what actually moves these:
-- a cook accepts/rejects (order_status), then separately marks payment_status
-- 'paid' once they've received the PayNow transfer off-platform — same
-- trust-based, no-in-app-gateway pattern already used for rider-pays-picker.
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  order_status text not null default 'placed' check (order_status in ('placed', 'accepted', 'rejected')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  subtotal numeric(7,2) not null check (subtotal > 0),
  decided_at timestamptz, -- set when order_status moves to accepted/rejected
  paid_at timestamptz, -- set when payment_status moves to paid
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

drop policy if exists "Customers can create their own orders" on public.orders;
create policy "Customers can create their own orders"
  on public.orders for insert
  with check (auth.uid() = customer_id);

drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
  on public.orders for select
  using (auth.uid() = customer_id);

drop policy if exists "Cooks can read orders placed at their kitchen" on public.orders;
create policy "Cooks can read orders placed at their kitchen"
  on public.orders for select
  using (auth.uid() = kitchen_id);

-- Transition rules (can't decide an already-decided order, can't mark paid
-- before accepted) are enforced by the app's update calls including the
-- expected current state in their WHERE clause, not by this policy — same
-- "first to accept wins" level of rigor already used for pickup_requests.
drop policy if exists "Cooks can update orders placed at their kitchen" on public.orders;
create policy "Cooks can update orders placed at their kitchen"
  on public.orders for update
  using (auth.uid() = kitchen_id)
  with check (auth.uid() = kitchen_id);

drop policy if exists "Admins can read every order" on public.orders;
create policy "Admins can read every order"
  on public.orders for select
  using (public.has_role('admin'));

-- ----------------------------------------------------------------------------
-- 13. ORDER ITEMS
-- One row per line item. name/price are snapshotted at order time (copied
-- from menu_items, not joined live) so a later menu edit or deletion never
-- rewrites what a customer actually ordered and was charged for. The Partner
-- app's KitchenSetupForm replaces a kitchen's menu_items wholesale on every
-- save, so menu_item_id is set null (not cascaded) if the original row is
-- gone — the snapshot is what matters for order history.
-- ----------------------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,
  price numeric(6,2) not null check (price > 0),
  quantity int not null check (quantity > 0)
);

alter table public.order_items enable row level security;

drop policy if exists "Customers can create items on their own orders" on public.order_items;
create policy "Customers can create items on their own orders"
  on public.order_items for insert
  with check (
    exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid())
  );

drop policy if exists "Customers can read items on their own orders" on public.order_items;
create policy "Customers can read items on their own orders"
  on public.order_items for select
  using (
    exists (select 1 from public.orders o where o.id = order_items.order_id and o.customer_id = auth.uid())
  );

drop policy if exists "Cooks can read items on orders placed at their kitchen" on public.order_items;
create policy "Cooks can read items on orders placed at their kitchen"
  on public.order_items for select
  using (
    exists (select 1 from public.orders o where o.id = order_items.order_id and o.kitchen_id = auth.uid())
  );

drop policy if exists "Admins can read every order item" on public.order_items;
create policy "Admins can read every order item"
  on public.order_items for select
  using (public.has_role('admin'));


-- ============================================================================
-- KOPI BOY 2.0 — Feature #006: Cook Accept/Reject + PayNow
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor. (The order_status/payment_status split lives inside the #005
-- section above rather than as an ALTER here, since that migration hadn't
-- been run anywhere yet when #006 started.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 14. PAYNOW DETAILS ON KITCHENS
-- Previously only captured once on cook_applications (immutable after that
-- one-time form). Moved to kitchens — the live, cook-editable merchant
-- profile — so a customer has somewhere current to read it from once their
-- order is accepted, and a cook can update it later via the Partner app's
-- KitchenSetupForm. Backfilled below from each cook's most recently
-- approved application; the existing "Cooks can update their own kitchen" /
-- "Anyone can read live kitchens" policies already cover this column, no
-- new RLS needed.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists paynow_uen text;

update public.kitchens k
set paynow_uen = (
  select ca.paynow_uen
  from public.cook_applications ca
  where ca.user_id = k.id and ca.status = 'approved'
  order by ca.reviewed_at desc nulls last
  limit 1
)
where k.paynow_uen is null;


-- ============================================================================
-- KOPI BOY 2.0 — Kitchen Preparation Status
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 15. PREPARATION STATUS ON ORDERS
-- Separate from order_status (accept/reject) and payment_status (PayNow),
-- per the locked "order/payment/preparation/delivery/incident are separate
-- status fields" rule in docs/feature-001.md. Set by the cook via the
-- Partner app once an order is accepted; the Customer app reads it on the
-- order confirmation screen. The existing "Customers can read their own
-- orders" / "Cooks can update orders placed at their kitchen" policies and
-- the table-level GRANTs in the section below already cover this column —
-- GRANT SELECT/UPDATE in Postgres applies to every column on a table, so
-- adding a column never needs its own grant or policy.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists preparation_status text
  not null default 'not_started'
  check (preparation_status in ('not_started', 'preparing', 'ready'));


-- ----------------------------------------------------------------------------
-- 16. PAYNOW TYPE/VALUE ON KITCHENS
-- Replaces the UEN-only paynow_uen column: cooks can now register PayNow
-- against either a mobile number or a UEN. paynow_type says which one
-- paynow_value holds, so the Customer app's order confirmation screen can
-- render the right label ("Pay via PayNow to +65 ..." vs "... to UEN ...").
-- Existing paynow_uen values are all UENs (the only option before this
-- change), so they backfill straight into paynow_value with type 'uen'.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists paynow_type text check (paynow_type in ('mobile', 'uen'));
alter table public.kitchens add column if not exists paynow_value text;

update public.kitchens
set paynow_type = 'uen', paynow_value = paynow_uen
where paynow_uen is not null and paynow_value is null;

alter table public.kitchens drop column if exists paynow_uen;


-- ============================================================================
-- KOPI BOY 2.0 — Kitchen + Customer Geolocation
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 17. LATITUDE + LONGITUDE ON KITCHENS
-- Real coordinates alongside (not replacing) the free-text `neighbourhood`
-- field, captured via the browser's Geolocation API in the Partner app's
-- KitchenSetupForm (this column's migration lives there too — repeated here,
-- idempotently, so this repo's copy of the schema stays a complete, run-once
-- script). Optional: a cook can decline the permission prompt and still go
-- live with neighbourhood text alone.
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists latitude numeric(9,6);
alter table public.kitchens add column if not exists longitude numeric(9,6);

-- ----------------------------------------------------------------------------
-- 18. CUSTOMER LOCATION + DELIVERY FEE ESTIMATE ON ORDERS
-- customer_lat/customer_lng are captured once at checkout via "Use my
-- current location" (see src/lib/use-customer-location.ts) and saved with
-- the order — not a live profile field, just a one-time snapshot for that
-- delivery. Both optional: declining the permission prompt (or an
-- unsupported browser) never blocks placing an order, it just leaves these
-- null and skips delivery_fee_estimate.
--
-- delivery_fee_estimate is computed server-side in placeOrder() from
-- customer_lat/lng and the kitchen's own latitude/longitude (Haversine
-- straight-line distance, see src/lib/distance.ts) — never trusted from the
-- client, same as subtotal above. It's shown to the customer as an estimate
-- only: per the locked "delivery fee belongs 100% to the rider, cook pays
-- rider on pickup" rule (docs/feature-001.md), the real fee is agreed
-- directly between cook and rider off-platform, not collected here.
--
-- No new GRANT needed — same as sections 15/16, the existing
-- `grant select, insert, update on public.orders to authenticated` below is
-- table-level and already covers these columns.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists customer_lat numeric(9,6);
alter table public.orders add column if not exists customer_lng numeric(9,6);
alter table public.orders add column if not exists delivery_fee_estimate numeric(5,2);


-- ============================================================================
-- KOPI BOY 2.0 — Table Grants
-- RLS policies only apply once the calling Postgres role already has the
-- underlying table privilege — GRANT is checked before RLS is ever
-- evaluated, so a role with no GRANT gets "permission denied for table X"
-- no matter how permissive its policies are. New Supabase projects normally
-- get default grants for anon/authenticated automatically; this section
-- exists to restore them if a project (or a table created outside the
-- dashboard) is missing them. Re-running GRANT is always safe/idempotent.
-- ============================================================================
grant usage on schema public to anon, authenticated;

-- Marketplace browsing works logged-out — RLS still restricts these to
-- is_live = true rows (kitchens) / rows belonging to a live kitchen (menu_items).
grant select on public.kitchens, public.menu_items to anon;

-- Everything else requires a signed-in user; RLS still restricts each row to
-- what that specific user (or an admin) is allowed to see or change.
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.cook_applications to authenticated;
grant select, insert, update on public.rider_applications to authenticated;
grant select, insert, update on public.picker_applications to authenticated;
grant select, insert, update on public.pickup_requests to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert on public.order_items to authenticated;
grant select, insert, update, delete on public.kitchens to authenticated;
grant select, insert, update, delete on public.menu_items to authenticated;


-- ============================================================================
-- KOPI BOY 2.0 — Customer order cancellation + delivery status visibility
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor. `order_status = 'cancelled'` and `delivery_requests` (with its
-- `release_requested` state) already exist live, added by the Partner app's
-- own migrations (Feature #008 + rider-release follow-up) — this section is
-- this repo's idempotent copy of those, same convention as section 17,
-- plus the pieces that are specifically this app's: the customer-cancel
-- policy and the customer's read access to delivery_requests.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 19. ORDER CANCELLATION
-- A customer can cancel their own order only while it's still 'placed' — the
-- app's cancelOrder() action includes `order_status = 'placed'` in its
-- update's WHERE clause (same "current state in the WHERE clause" pattern as
-- every other transition here), and this policy is the server-side backstop
-- for that same rule. decided_at now also marks "when order_status last
-- moved away from placed", covering cancel same as accept/reject.
-- ----------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_order_status_check;
alter table public.orders add constraint orders_order_status_check
  check (order_status in ('placed', 'accepted', 'rejected', 'cancelled'));

alter table public.orders add column if not exists ready_at timestamptz; -- set when preparation_status moves to 'ready'

drop policy if exists "Customers can cancel their own placed orders" on public.orders;
create policy "Customers can cancel their own placed orders"
  on public.orders for update
  using (auth.uid() = customer_id and order_status = 'placed')
  with check (auth.uid() = customer_id and order_status = 'cancelled');

-- ----------------------------------------------------------------------------
-- 20. DELIVERY REQUESTS (idempotent copy — owned by the Partner app, see #008)
-- ----------------------------------------------------------------------------
create table if not exists public.delivery_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  rider_id uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'accepted', 'completed', 'cancelled', 'release_requested')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);

alter table public.delivery_requests enable row level security;

grant select, insert, update on public.delivery_requests to authenticated;

-- Customer-facing addition: the order confirmation screen's rider-assigned /
-- delivered stages need to read the delivery_requests row for the
-- customer's own order — none of the Partner app's policies cover that.
drop policy if exists "Customers can read delivery requests for their own orders" on public.delivery_requests;
create policy "Customers can read delivery requests for their own orders"
  on public.delivery_requests for select
  using (
    exists (select 1 from public.orders o where o.id = delivery_requests.order_id and o.customer_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 20a. RIDER INFO FOR THE CUSTOMER'S ORDER — defined in the Partner app's schema
-- The order page shows "Your rider: {name}" + photo by calling
-- public.get_order_rider(p_order_id uuid), which is defined ONCE, in the
-- Partner app's docs/supabase-schema.sql (section 24, together with
-- profiles.photo_url and the rider-photos bucket it depends on). It is
-- deliberately NOT redefined here: two `create or replace`s of one signature
-- silently overwrite each other, whichever script ran last.
--
-- Contract this app relies on (keep the Partner's definition to it):
--   returns table (full_name text, photo_url text) — nothing else (profiles
--   RLS is own-row only, so this SECURITY DEFINER function is the only path,
--   and it must not expose phone / contact details);
--   only for the caller's own order, when its delivery_request is 'accepted'
--   or 'completed' (completed preferred) — so the rider stays visible after
--   delivery; open / cancelled / release_requested reveal nothing;
--   EXECUTE for `authenticated` only.
-- Until the Partner's script has run, the RPC errors and the order page just
-- shows no rider card.
-- ----------------------------------------------------------------------------


-- ============================================================================
-- KOPI BOY 2.0 — Customer notifications (in-app inbox + live toast)
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor. Safe to re-run (idempotent).
--
-- The Partner app (cook/rider) is what moves order_status / payment_status /
-- preparation_status / delivery_requests.status, so notifications are created
-- by database triggers on those tables — NOT by this app's code — which means
-- the Partner app needs no changes. The Customer app only reads its own rows
-- (Supabase Realtime pushes new ones to any open tab) and marks them read.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 21. NOTIFICATIONS
-- One row per customer-facing event. `read_at` null = unread. Rows are
-- written ONLY by the trigger functions below (SECURITY DEFINER) — the
-- `authenticated` role gets no INSERT/DELETE at all, so a customer can't
-- forge or wipe notifications, and can only ever flip read_at on their own.
--
-- SHARED TABLE: the Partner app's docs/supabase-notifications.sql creates
-- this same public.notifications for cooks / riders / pickers. The definition
-- below is deliberately IDENTICAL to theirs (category, free-text type, url,
-- ref_id — there is no order_id column), so it doesn't matter which script
-- runs first: the second `create table if not exists` is a no-op and both
-- apps' triggers write into the one table. For a customer notification,
-- ref_id = the order and url = '/orders/<id>' (where a tap goes).
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('orders', 'deliveries', 'pickups', 'account')),
  type text not null,
  title text not null,
  body text,
  url text not null default '/',
  ref_id uuid, -- the order / request the notification is about (used to dedupe reminders)
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_type_ref_idx
  on public.notifications (type, ref_id);

alter table public.notifications enable row level security;

drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "Users can mark their own notifications read" on public.notifications;
create policy "Users can mark their own notifications read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Supabase auto-grants every new public table to anon + authenticated via
-- default privileges, so start from zero and grant back only what's needed:
-- read own rows, and update the read_at column only (column-level grant —
-- title/body/type/user_id can never be edited from the client).
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ----------------------------------------------------------------------------
-- 22. REALTIME
-- Adds the tables the Customer app subscribes to (postgres_changes) to the
-- supabase_realtime publication: `notifications` drives the bell/toast, and
-- `orders` + `delivery_requests` let an open order page refresh the moment
-- the cook/rider acts, instead of polling. Realtime only delivers a row to a
-- subscriber whose RLS SELECT policy allows it, so a customer still only ever
-- receives their own rows. ALTER PUBLICATION ... ADD TABLE isn't idempotent
-- on its own (errors if already a member), hence the guards.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications', 'orders', 'delivery_requests'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 23. NOTIFICATION WRITER
-- The single place a notification row gets inserted. SECURITY DEFINER so it
-- can write past RLS/GRANTs, which is exactly why EXECUTE is revoked from
-- every client role below — otherwise PostgREST would expose it as
-- /rpc/create_customer_notification and anyone could forge notifications.
-- Trigger functions run as the table owner, which keeps EXECUTE.
-- ----------------------------------------------------------------------------
--
-- Maps a customer event onto the shared table's real columns: category is
-- 'deliveries' for the rider events and 'orders' for everything else, ref_id
-- is the order, url is its page. Like every trigger in the Partner's
-- notifications script, a failure here is downgraded to a WARNING: a
-- notification problem must never roll back the real write (the customer's
-- order / the cook's or rider's status change) that fired the trigger.
create or replace function public.create_customer_notification(
  p_user_id uuid,
  p_order_id uuid,
  p_type text,
  p_title text,
  p_body text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, category, type, title, body, url, ref_id)
  values (
    p_user_id,
    case when p_type in ('rider_assigned', 'order_delivered') then 'deliveries' else 'orders' end,
    p_type,
    p_title,
    p_body,
    case when p_order_id is null then '/' else '/orders/' || p_order_id end,
    p_order_id
  );
exception when others then
  raise warning 'create_customer_notification failed: %', sqlerrm;
end;
$$;

revoke all on function public.create_customer_notification(uuid, uuid, text, text, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 24. TRIGGERS
-- orders: placed (insert), then order_status -> accepted/rejected/cancelled,
-- payment_status -> paid, preparation_status -> ready. Every branch is guarded
-- by IS DISTINCT FROM so re-saving an unchanged value never re-notifies.
-- delivery_requests: status -> accepted (rider assigned) / completed
-- (delivered). Like the writer above, both are SECURITY DEFINER (they read
-- kitchens, which a customer's RLS may not show — e.g. a kitchen that has
-- since gone offline) and are not callable by clients.
-- Event timers (kitchen slow to accept, no rider found, payment reminder)
-- are intentionally NOT here — they'll need a scheduler (pg_cron).
-- ----------------------------------------------------------------------------
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
        'Your order from ' || v_kitchen || ' was cancelled.'
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

revoke all on function public.notify_customer_on_order_change() from public, anon, authenticated;

drop trigger if exists notify_customer_on_order_change on public.orders;
create trigger notify_customer_on_order_change
  after insert or update of order_status, payment_status, preparation_status on public.orders
  for each row execute function public.notify_customer_on_order_change();

create or replace function public.notify_customer_on_delivery_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_kitchen text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('accepted', 'completed') then
    return new;
  end if;

  select o.customer_id, k.business_name
    into v_customer_id, v_kitchen
  from public.orders o
  left join public.kitchens k on k.id = o.kitchen_id
  where o.id = new.order_id;
  if v_customer_id is null then
    return new;
  end if;
  v_kitchen := coalesce(v_kitchen, 'the kitchen');

  if new.status = 'accepted' then
    perform public.create_customer_notification(
      v_customer_id, new.order_id, 'rider_assigned', 'Rider on the way',
      'A rider has been assigned and is heading to ' || v_kitchen || ' to pick up your order.'
    );
  else
    perform public.create_customer_notification(
      v_customer_id, new.order_id, 'order_delivered', 'Order delivered',
      'Your order from ' || v_kitchen || ' has been delivered. Enjoy!'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_customer_on_delivery_change() from public, anon, authenticated;

drop trigger if exists notify_customer_on_delivery_change on public.delivery_requests;
create trigger notify_customer_on_delivery_change
  after insert or update of status on public.delivery_requests
  for each row execute function public.notify_customer_on_delivery_change();


-- ============================================================================
-- KOPI BOY 2.0 — Customer <-> HQ support chat (complaints) + order history cap
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor. Safe to re-run (idempotent). See docs/support-chat.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 25. COMPLAINT MESSAGES
-- A free-form thread between an order's customer and HQ (any admin), tied to
-- one order. Same shape as the Partner-owned public.messages (rider chat),
-- plus an optional evidence photo — but a different "who" and no "until
-- when": the thread never closes, it stays readable as the record of the
-- complaint whatever state the order ends up in.
--
-- photo_path is a key in the PRIVATE complaint-photos bucket (section 26),
-- not a URL: evidence photos are never publicly reachable, the app turns the
-- path into a short-lived signed URL when it renders. The check pins the
-- path under this order's own folder, so a message can't point at another
-- order's evidence.
-- ----------------------------------------------------------------------------
create table if not exists public.complaint_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  photo_path text,
  created_at timestamptz not null default now(),
  constraint complaint_messages_body_check
    check (length(body) <= 2000 and (length(btrim(body)) > 0 or photo_path is not null)),
  constraint complaint_messages_photo_path_check
    check (photo_path is null or photo_path like order_id::text || '/%')
);

create index if not exists complaint_messages_order_created_idx
  on public.complaint_messages (order_id, created_at);

alter table public.complaint_messages enable row level security;

-- Same start-from-zero grant as notifications: read + send only, no update
-- or delete — a complaint thread is evidence and must be immutable. (Section
-- 29 lets the order's customer delete an UNRESOLVED thread: "Clear chat".)
revoke all on public.complaint_messages from anon, authenticated;
grant select, insert on public.complaint_messages to authenticated;

-- Idempotent copy — owned by the Partner app's schema, where it's the
-- canonical role check. Repeated here verbatim so this section also runs on a
-- database where the Partner script hasn't been run yet. HQ access to
-- complaint threads (this app and the Boss app's /complaints) goes through
-- user_has_role('admin'), not has_role().
create or replace function public.user_has_role(check_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = check_role
  );
$$;

-- SECURITY DEFINER for the same reason as order_chat_participant(): the
-- check must not depend on the caller's own orders RLS, and user_has_role()
-- reads profiles. No terminal-state condition, on purpose — see above.
create or replace function public.complaint_thread_participant(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_role('admin')
    or exists (select 1 from public.orders o where o.id = p_order_id and o.customer_id = auth.uid());
$$;

revoke all on function public.complaint_thread_participant(uuid) from public, anon;
grant execute on function public.complaint_thread_participant(uuid) to authenticated;

drop policy if exists "Customer and HQ can read the order's complaint thread" on public.complaint_messages;
create policy "Customer and HQ can read the order's complaint thread"
  on public.complaint_messages for select
  using (public.complaint_thread_participant(order_id));

drop policy if exists "Customer and HQ can post to the order's complaint thread" on public.complaint_messages;
create policy "Customer and HQ can post to the order's complaint thread"
  on public.complaint_messages for insert
  with check (sender_id = auth.uid() and public.complaint_thread_participant(order_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'complaint_messages'
    ) then
    execute 'alter publication supabase_realtime add table public.complaint_messages';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 26. COMPLAINT PHOTOS BUCKET (private)
-- Object key: <order_id>/<uploader_id>/<random>.<ext>. Read and upload are
-- allowed to exactly the people who can read/post the order's thread
-- (complaint_thread_participant on the first folder); uploads must also sit
-- in the uploader's own sub-folder. No update/delete policy: evidence is
-- immutable. The regex guard keeps a non-uuid folder name from raising a
-- cast error inside the policy (which would fail the whole query) — such a
-- key is simply not allowed.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('complaint-photos', 'complaint-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Complaint thread participants can view its photos" on storage.objects;
create policy "Complaint thread participants can view its photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'complaint-photos'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.complaint_thread_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

drop policy if exists "Complaint thread participants can upload photos" on storage.objects;
create policy "Complaint thread participants can upload photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'complaint-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.complaint_thread_participant(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- ----------------------------------------------------------------------------
-- 27. ORDER HISTORY CAP — archive, never delete
-- A customer's order-history LIST shows at most their 10 newest orders.
-- Older ones are NOT deleted: an order row is shared with the cook (sales
-- record), the rider (delivery_requests cascade off it), HQ (Boss app
-- /orders) and the complaint thread above, all of which ON DELETE CASCADE
-- would wipe. Instead customer_archived_at is stamped, and any customer-facing
-- history list must filter on it:
--   .from("orders").select(...).is("customer_archived_at", null)
-- It is deliberately NOT an RLS rule (see section 28): the order still
-- belongs to the customer, so a direct link to it — e.g. from an old
-- notification — keeps working. Cook / rider / admin never look at it.
--
-- Mechanism: an AFTER INSERT trigger on orders — the moment a customer's
-- 11th order lands, their oldest is archived. No pg_cron: nothing here is
-- time-based, the count only ever changes on insert.
--
-- Only SETTLED orders are archived (cancelled, rejected, or delivered). An
-- order still in flight is never dropped from the list of the person waiting
-- on it; it's picked up by the next insert after it settles. So a customer
-- with 11+ live orders at once can briefly see more than 10.
-- ----------------------------------------------------------------------------
alter table public.orders add column if not exists customer_archived_at timestamptz;

create index if not exists orders_customer_created_idx
  on public.orders (customer_id, created_at desc);

create or replace function public.archive_old_customer_orders(p_customer_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders o
  set customer_archived_at = now()
  where o.customer_id = p_customer_id
    and o.customer_archived_at is null
    and o.id not in (
      select k.id from public.orders k
      where k.customer_id = p_customer_id
      order by k.created_at desc, k.id desc
      limit 10
    )
    and (
      o.order_status in ('cancelled', 'rejected')
      or exists (select 1 from public.delivery_requests d where d.order_id = o.id and d.status = 'completed')
    );
$$;

revoke all on function public.archive_old_customer_orders(uuid) from public, anon, authenticated;

create or replace function public.archive_old_orders_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.archive_old_customer_orders(new.customer_id);
  return null;
exception when others then
  -- Same rule as the notification triggers: housekeeping must never roll
  -- back the customer's actual order.
  raise warning 'archive_old_customer_orders failed: %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.archive_old_orders_on_insert() from public, anon, authenticated;

drop trigger if exists archive_old_orders_on_insert on public.orders;
create trigger archive_old_orders_on_insert
  after insert on public.orders
  for each row execute function public.archive_old_orders_on_insert();

-- Only the archive function may set/clear the column. `authenticated` has a
-- table-wide UPDATE grant on orders (cook status changes, customer cancel),
-- so without this a cook could drop an order from its customer's history, or
-- a customer could un-archive one. The SECURITY DEFINER function above runs as
-- the table owner, so current_user tells the two apart.
create or replace function public.protect_customer_archived_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.customer_archived_at := old.customer_archived_at;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_customer_archived_at on public.orders;
create trigger protect_customer_archived_at
  before update of customer_archived_at on public.orders
  for each row execute function public.protect_customer_archived_at();

-- One-off backfill for customers who already have more than 10 orders.
select public.archive_old_customer_orders(c.customer_id)
from (select distinct customer_id from public.orders) c;

-- ----------------------------------------------------------------------------
-- 28. CUSTOMER ORDERS POLICY — archived orders stay readable
-- Same policy as section 12, re-applied here on purpose: an earlier version
-- of this section added `and customer_archived_at is null`, which made an
-- archived order 404 when opened from an old notification. Archiving only
-- trims the history list (section 27); a customer can always open their own
-- order by direct link. Re-running this restores that on a database where the
-- earlier version already ran.
-- ----------------------------------------------------------------------------
drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
  on public.orders for select
  using (auth.uid() = customer_id);

-- ----------------------------------------------------------------------------
-- 29. RESOLVED THREADS + CLEAR CHAT
-- HQ marks a complaint thread resolved by inserting a row into
-- complaint_resolutions (Boss app /complaints, or the SQL Editor until that
-- page exists). Admin-only, insert-only: there is no update/delete policy or
-- grant, so a resolved thread can't be reopened.
--
-- While a thread is UNRESOLVED, the order's customer may permanently delete it
-- ("Clear chat" in SupportChat): every message of the thread (HQ's replies
-- included) and every photo under the order's folder in complaint-photos (HQ's
-- uploads included). A real DELETE, not a hide. Once resolved, the delete
-- policies below stop matching and the thread is a permanent record —
-- deliberately narrowing the "immutable evidence" rule of sections 25–26
-- rather than dropping it. Admins never get delete.
--
-- Section 25 revokes then grants select/insert, so it wipes this DELETE grant
-- if re-run on its own; re-running the whole script (or this section after
-- it) restores it.
--
-- Photos must be removed through the Storage API (supabase.storage.remove),
-- which needs both the select policy above and the delete policy below;
-- Supabase blocks deleting storage.objects rows directly in SQL.
-- ----------------------------------------------------------------------------
create table if not exists public.complaint_resolutions (
  order_id uuid primary key references public.orders(id) on delete cascade,
  resolved_by uuid not null references public.profiles(id),
  resolved_at timestamptz not null default now()
);

alter table public.complaint_resolutions enable row level security;

revoke all on public.complaint_resolutions from anon, authenticated;
grant select, insert on public.complaint_resolutions to authenticated;

drop policy if exists "Customer and HQ can see whether the thread is resolved" on public.complaint_resolutions;
create policy "Customer and HQ can see whether the thread is resolved"
  on public.complaint_resolutions for select
  using (public.complaint_thread_participant(order_id));

drop policy if exists "HQ can mark a thread resolved" on public.complaint_resolutions;
create policy "HQ can mark a thread resolved"
  on public.complaint_resolutions for insert
  with check (resolved_by = auth.uid() and public.user_has_role('admin'));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'complaint_resolutions'
    ) then
    execute 'alter publication supabase_realtime add table public.complaint_resolutions';
  end if;
end $$;

-- The caller is the order's customer AND the thread isn't resolved.
-- SECURITY DEFINER like complaint_thread_participant(): must not depend on
-- the caller's own RLS on orders/complaint_resolutions.
create or replace function public.complaint_thread_clearable(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.orders o where o.id = p_order_id and o.customer_id = auth.uid())
    and not exists (select 1 from public.complaint_resolutions r where r.order_id = p_order_id);
$$;

revoke all on function public.complaint_thread_clearable(uuid) from public, anon;
grant execute on function public.complaint_thread_clearable(uuid) to authenticated;

grant delete on public.complaint_messages to authenticated;

drop policy if exists "Customer can clear the order's complaint thread" on public.complaint_messages;
drop policy if exists "Customer can clear an unresolved complaint thread" on public.complaint_messages;
create policy "Customer can clear an unresolved complaint thread"
  on public.complaint_messages for delete
  using (public.complaint_thread_clearable(order_id));

drop policy if exists "Customer can delete the order's complaint photos" on storage.objects;
drop policy if exists "Customer can delete an unresolved thread's photos" on storage.objects;
create policy "Customer can delete an unresolved thread's photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'complaint-photos'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.complaint_thread_clearable(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- Replaced by complaint_thread_clearable (only exists if an earlier draft of
-- this section ran); the policies that used it were dropped above.
drop function if exists public.complaint_thread_customer(uuid);

-- ----------------------------------------------------------------------------
-- 30. KITCHENS / MENU ITEMS — role-gated policies are signed-in only
-- Logged-out visitors hit "permission denied for table profiles" on the home
-- page. Postgres checks every select policy on a table, including the
-- admin one, and anon has no grant on profiles (the Table Grants block
-- gives it to authenticated only). Scoping the cook/admin policies `to authenticated`
-- means anon never checks them. The two "Anyone can read ..." policies
-- stay open to anon so logged-out browsing keeps working. Recreated rather
-- than altered so a live database whose copy of a policy drifted (e.g. an
-- inline profiles subquery instead of has_role) is reset to this definition.
-- ----------------------------------------------------------------------------
drop policy if exists "Cooks can read their own kitchen" on public.kitchens;
create policy "Cooks can read their own kitchen"
  on public.kitchens for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Cooks can insert their own kitchen" on public.kitchens;
create policy "Cooks can insert their own kitchen"
  on public.kitchens for insert
  to authenticated
  with check (auth.uid() = id and public.has_role('cook'));

drop policy if exists "Cooks can update their own kitchen" on public.kitchens;
create policy "Cooks can update their own kitchen"
  on public.kitchens for update
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Admins can read every kitchen" on public.kitchens;
create policy "Admins can read every kitchen"
  on public.kitchens for select
  to authenticated
  using (public.has_role('admin'));

drop policy if exists "Cooks can manage their own menu items" on public.menu_items;
create policy "Cooks can manage their own menu items"
  on public.menu_items for all
  to authenticated
  using (auth.uid() = kitchen_id)
  with check (auth.uid() = kitchen_id);


-- ============================================================================
-- KOPI BOY 2.0 — Order ratings (1-5 stars, one per order)
-- Run this ONCE, after every script above, in the same Supabase project's
-- SQL Editor. Safe to re-run (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 31. RATINGS
-- One row per delivered order (order_id unique — a customer rates an order
-- once, and can't change or delete it afterwards: no update/delete grant).
-- kitchen_id is stored alongside rather than joined through orders so the
-- per-kitchen average below doesn't need to read orders (which RLS hides from
-- everyone but the customer and the cook).
-- ----------------------------------------------------------------------------
create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists ratings_kitchen_idx on public.ratings (kitchen_id);

alter table public.ratings enable row level security;

revoke all on public.ratings from anon, authenticated;
grant select, insert on public.ratings to authenticated;

-- Is the caller allowed to rate this order, for this kitchen? Same shape as
-- order_chat_participant() / complaint_thread_participant(): SECURITY DEFINER
-- so the check doesn't depend on the caller's own RLS on orders /
-- delivery_requests. True only for the order's own customer, only once a
-- delivery_request for it is 'completed' (the same "Delivered" the order page
-- shows), never for a cancelled/rejected order, and only when p_kitchen_id is
-- the order's real kitchen — so a rating can't be pinned on another kitchen.
create or replace function public.order_ratable(p_order_id uuid, p_kitchen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.customer_id = auth.uid()
      and o.kitchen_id = p_kitchen_id
      and o.order_status not in ('cancelled', 'rejected')
      and exists (
        select 1 from public.delivery_requests d
        where d.order_id = o.id and d.status = 'completed'
      )
  );
$$;

revoke all on function public.order_ratable(uuid, uuid) from public, anon;
grant execute on function public.order_ratable(uuid, uuid) to authenticated;

drop policy if exists "Customers can rate their own delivered orders" on public.ratings;
create policy "Customers can rate their own delivered orders"
  on public.ratings for insert
  to authenticated
  with check (customer_id = auth.uid() and public.order_ratable(order_id, kitchen_id));

-- Own rows only — the order page uses this to know whether the order has
-- already been rated. Everyone else sees only the aggregate view below.
drop policy if exists "Customers can read their own ratings" on public.ratings;
create policy "Customers can read their own ratings"
  on public.ratings for select
  to authenticated
  using (customer_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 32. KITCHEN RATING SUMMARY
-- Average + count per kitchen, computed live on every read (no stored
-- counter to drift). security_invoker = false on purpose: the view runs as
-- its owner so it can aggregate every customer's rating, while exposing only
-- the average and count — never who rated what. Restricted to live kitchens,
-- the same set the marketplace can already see. A kitchen with no ratings has
-- no row here; the app treats a missing row as "No ratings yet".
-- ----------------------------------------------------------------------------
create or replace view public.kitchen_rating_summary
with (security_invoker = false) as
  select r.kitchen_id,
         round(avg(r.stars)::numeric, 1)::float8 as average,
         count(*)::int as rating_count
  from public.ratings r
  join public.kitchens k on k.id = r.kitchen_id and k.is_live
  group by r.kitchen_id;

revoke all on public.kitchen_rating_summary from anon, authenticated;
grant select on public.kitchen_rating_summary to anon, authenticated;

-- Not added to the supabase_realtime publication: the only writer is the
-- rating customer themselves, whose page refreshes after submitting, and a
-- marketplace average doesn't need to tick live.
