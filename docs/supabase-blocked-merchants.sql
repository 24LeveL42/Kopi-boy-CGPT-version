-- ============================================================================
-- KOPI BOY 2.0 — Blocked merchants shown as "Currently unavailable"
-- Run this ONCE, after docs/supabase-schema.sql, in the same Supabase
-- project's SQL Editor. Safe to re-run (idempotent).
--
-- The Boss app blocks a cook by setting profiles.is_active = false (schema
-- section 1/5 — only an admin can change it). Customers can't read other
-- people's profiles, so the Customer app can't see that flag directly. This
-- mirrors it onto kitchens.is_blocked, which customers can already read for
-- any live kitchen. It is a plain yes/no: no reason or note is copied, so
-- customers only ever learn "Currently unavailable".
--
-- A blocked kitchen stays is_live = true on purpose: it keeps showing (faded)
-- in the marketplace, and every existing order, rating, chat and delivery
-- that joins to it keeps working. Only NEW orders are refused.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 33. kitchens.is_blocked
-- ----------------------------------------------------------------------------
alter table public.kitchens add column if not exists is_blocked boolean not null default false;

-- ----------------------------------------------------------------------------
-- 34. KEEP is_blocked = NOT owner's profiles.is_active
-- One BEFORE INSERT/UPDATE trigger on kitchens always recomputes is_blocked
-- from the owner's profile. That covers new kitchens, and also means a cook
-- (who may update their own kitchen row) can never unblock themselves by
-- writing is_blocked = false. SECURITY DEFINER so it can read profiles
-- whoever is saving the kitchen.
-- ----------------------------------------------------------------------------
create or replace function public.set_kitchen_is_blocked()
returns trigger as $$
begin
  new.is_blocked := coalesce(
    (select not p.is_active from public.profiles p where p.id = new.id),
    false
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists before_kitchen_set_is_blocked on public.kitchens;
create trigger before_kitchen_set_is_blocked
  before insert or update on public.kitchens
  for each row execute function public.set_kitchen_is_blocked();

-- AFTER UPDATE on profiles (so it sees the value that survived
-- protect_profile_privileges): touches the owner's kitchen, which fires the
-- trigger above to recompute is_blocked. SECURITY DEFINER because admins have
-- no update policy on kitchens.
create or replace function public.sync_kitchen_is_blocked()
returns trigger as $$
begin
  update public.kitchens
     set is_blocked = not new.is_active
   where id = new.id
     and is_blocked is distinct from (not new.is_active);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists after_profile_is_active_change on public.profiles;
create trigger after_profile_is_active_change
  after update of is_active on public.profiles
  for each row
  when (old.is_active is distinct from new.is_active)
  execute function public.sync_kitchen_is_blocked();

-- ----------------------------------------------------------------------------
-- 35. BACKFILL from the owner's current profiles.is_active
-- The no-op assignment fires before_kitchen_set_is_blocked, which sets the
-- right value. Only rows that are out of sync are touched.
-- ----------------------------------------------------------------------------
update public.kitchens k
   set is_blocked = not p.is_active
  from public.profiles p
 where p.id = k.id
   and k.is_blocked is distinct from (not p.is_active);

-- ----------------------------------------------------------------------------
-- 36. NO NEW ORDERS TO A BLOCKED KITCHEN (database backstop)
-- The app's placeOrder already refuses, but "Customers can create their own
-- orders" would otherwise still let a signed-in customer insert an order
-- straight through the Supabase API. RESTRICTIVE, so it is ANDed with that
-- policy. INSERT only: existing orders keep updating/reading normally.
-- ----------------------------------------------------------------------------
drop policy if exists "No new orders to a blocked kitchen" on public.orders;
create policy "No new orders to a blocked kitchen"
  on public.orders
  as restrictive
  for insert
  to authenticated
  with check (
    not exists (select 1 from public.kitchens k where k.id = orders.kitchen_id and k.is_blocked)
  );
