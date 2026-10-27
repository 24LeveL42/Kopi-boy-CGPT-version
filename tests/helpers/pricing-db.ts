import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * A throwaway in-process Postgres (PGlite) carrying the REAL order-pricing SQL
 * from docs/, so tests run the same functions Supabase runs:
 *   - "old": supabase-promotions.sql (settings, promotions, live_promotions,
 *     PART 2 sections 2.1-2.6) — the database as it is before add-ons;
 *   - "new": the same, then supabase-addons.sql applied on top, exactly as
 *     the owner will run it.
 * Tables the pricing only touches at the edges (kitchens, menu_items, orders,
 * order_items, quote_delivery, auth.uid) are minimal stand-ins below with the
 * columns and checks the pricing relies on.
 */

const docs = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), "utf8");

/** The text from the line holding `start` up to (not including) the line holding `end`. */
function slice(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`docs SQL moved: can't find ${JSON.stringify(start)} .. ${JSON.stringify(end)}`);
  return text.slice(text.lastIndexOf("\n", from) + 1, text.lastIndexOf("\n", to) + 1);
}

/**
 * A statement that docs SQL keeps commented out ("-- select ..."), found by a
 * unique snippet of its commented text and returned runnable (prefix removed,
 * up to the line ending in ";").
 */
export function commentedStatement(text: string, snippet: string): string {
  const at = text.indexOf(snippet);
  if (at < 0) throw new Error(`commented statement not found: ${JSON.stringify(snippet)}`);
  const lines = text.slice(text.lastIndexOf("\n", at) + 1).split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const sql = line.replace(/^--\s?/, "");
    out.push(sql);
    if (sql.trimEnd().endsWith(";")) break;
  }
  return out.join("\n");
}

export const PROMOTIONS_SQL = docs("supabase-promotions.sql");
export const ADDONS_SQL = docs("supabase-addons.sql");

const BASE = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema private;
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.has_role(p_role text) returns boolean language sql stable as $$ select false $$;

create table public.profiles (id uuid primary key);
create table public.kitchens (
  id uuid primary key,
  is_live boolean not null default false,
  is_blocked boolean default false
);
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  name text not null,
  price numeric(6,2) not null check (price > 0),
  photo_url text,
  created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  kitchen_id uuid not null references public.kitchens(id),
  subtotal numeric(7,2) not null check (subtotal > 0),
  order_status text not null default 'placed',
  created_at timestamptz not null default now(),
  customer_postal_code text,
  customer_lat double precision,
  customer_lng double precision,
  delivery_type text,
  delivery_distance_km numeric,
  delivery_fee_estimate numeric,
  scheduled_for timestamptz,
  delivery_address_line text,
  delivery_unit text,
  delivery_notes text
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,
  price numeric(6,2) not null check (price > 0),
  quantity int not null check (quantity > 0)
);
create function public.quote_delivery(p_kitchen_id uuid, p_lat double precision, p_lng double precision, p_type text)
returns table (distance_km numeric, delivery_fee numeric) language sql stable
  as $$ select 2.5::numeric, 3.30::numeric $$;
grant select on public.kitchens, public.menu_items to anon, authenticated;
`;

function promotionsUpToPlaceOrder(): string {
  return [
    slice(PROMOTIONS_SQL, "create table if not exists public.app_settings", "alter table public.app_settings enable row level security"),
    "update public.app_settings set deals_enabled = true;\n",
    slice(PROMOTIONS_SQL, "-- 1.3 PROMOTIONS", "-- 1.4 RLS"),
    slice(PROMOTIONS_SQL, "create or replace view private.live_promotions", "-- 1.6 PUBLIC VIEWS"),
    slice(PROMOTIONS_SQL, "-- 2.1 ORDER COLUMNS", "-- 2.7 GIVE A DEAL BACK"),
  ].join("\n");
}

export async function createPricingDb(version: "old" | "new"): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(promotionsUpToPlaceOrder());
  if (version === "new") await db.exec(ADDONS_SQL);
  return db;
}

/** Deterministic UUIDs: id(7) = 00000000-0000-4000-8000-000000000007. */
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Runs fn inside a transaction that is always rolled back. */
export async function rolledBack<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    return await fn();
  } finally {
    await db.exec("rollback");
  }
}

export async function computePricing(db: PGlite, kitchenId: string, items: unknown, customerId: string | null = null) {
  const { rows } = await db.query<{ r: PricingResult }>(
    "select public.compute_order_pricing($1, $2::jsonb, $3) as r",
    [kitchenId, JSON.stringify(items), customerId]
  );
  return rows[0].r;
}

export interface PricingLine {
  line_no?: number;
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  discount_amount: number;
  options_price?: number;
  options?: { option_id: string; group_name: string; name: string; price: number; sort_order: number }[];
}

export interface PricingResult {
  subtotal: number;
  dish_subtotal?: number;
  options_subtotal?: number;
  discount_total: number;
  food_total: number;
  promotion_id: string | null;
  promotion_kind: string | null;
  promotion_label: string | null;
  promotion_units: number | null;
  lines: PricingLine[];
}

/**
 * Inside rolledBack(): runs one statement under a savepoint and returns its
 * error message (null on success), so the transaction carries on after an
 * expected failure.
 */
export async function attempt(db: PGlite, sql: string, params: unknown[] = []): Promise<string | null> {
  await db.exec("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.exec("release savepoint attempt");
    return null;
  } catch (e) {
    await db.exec("rollback to savepoint attempt");
    return (e as Error).message;
  }
}

/** The SQL error message (e.g. "option_sold_out"), or null when it succeeds. */
export async function errorOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
