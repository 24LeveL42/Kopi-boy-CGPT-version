// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { attempt, id, rolledBack } from "./helpers/pricing-db";

/**
 * docs/supabase-kitchen-privacy.sql, run for real (PGlite) on a kitchens
 * table with the live database's columns, the real kitchens / menu_items
 * read policies, and minimal stand-ins for what hero_candidates reads.
 */

const PRIVACY_SQL = readFileSync(new URL("../docs/supabase-kitchen-privacy.sql", import.meta.url), "utf8");

const PUBLIC_COLUMNS = [
  "id", "business_name", "category", "cuisine_type", "neighbourhood", "description", "hero_image", "is_live",
  "created_at", "updated_at", "business_uen", "postal_sector", "is_halal", "is_blocked", "live_since",
];
const HIDDEN_COLUMNS = ["paynow_type", "paynow_value", "latitude", "longitude", "acknowledged_terms_at"];

const LIVE = id(1);
const OFFLINE = id(2);
const CUSTOMER = id(500);
const STRANGER = id(501);
const ACCEPTED = id(601);
const PLACED = id(602);
const CANCELLED = id(603);

const schema = (withPostalSector: boolean) => `
create role anon;
create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.kitchens (
  id uuid primary key,
  business_name text not null,
  category text,
  cuisine_type text,
  neighbourhood text,
  description text,
  hero_image text,
  is_live boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paynow_type text,
  paynow_value text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  business_uen text,
  ${withPostalSector ? "postal_sector text," : ""}
  is_halal boolean default false,
  acknowledged_terms_at timestamptz,
  is_blocked boolean not null default false,
  live_since timestamptz
);
alter table public.kitchens enable row level security;
create policy "Anyone can read live kitchens" on public.kitchens for select using (is_live = true);
grant select on public.kitchens to anon;
grant select, insert, update, delete on public.kitchens to authenticated;

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id),
  name text not null
);
alter table public.menu_items enable row level security;
create policy "Anyone can read menu items of a live kitchen" on public.menu_items for select
  using (exists (select 1 from public.kitchens k where k.id = menu_items.kitchen_id and k.is_live = true));
grant select on public.menu_items to anon, authenticated;

create table public.orders (
  id uuid primary key,
  customer_id uuid not null,
  kitchen_id uuid not null references public.kitchens(id),
  order_status text not null default 'placed'
);
alter table public.orders enable row level security;

create table public.app_settings (
  id boolean primary key default true,
  hero_enabled boolean not null default true,
  hero_include_new_kitchens boolean not null default true,
  new_kitchen_days int not null default 14
);
insert into public.app_settings (id) values (true);
create table public.hero_exclusions (kitchen_id uuid, promotion_id uuid, until timestamptz);
create table public.active_deals (id uuid primary key, kitchen_id uuid, kind text, title text, ends_at timestamptz);

insert into public.kitchens (id, business_name, is_live, paynow_type, paynow_value, latitude, longitude, live_since, acknowledged_terms_at)
values
  ('${LIVE}', 'Aunty May', true, 'mobile', '91234567', 1.345678, 103.876543, now() - interval '2 days', now()),
  ('${OFFLINE}', 'Closed Kitchen', false, 'uen', '201912345K', 1.300001, 103.800001, null, null);
insert into public.menu_items (kitchen_id, name) values ('${LIVE}', 'Laksa'), ('${OFFLINE}', 'Hidden');
insert into public.orders (id, customer_id, kitchen_id, order_status) values
  ('${ACCEPTED}', '${CUSTOMER}', '${LIVE}', 'accepted'),
  ('${PLACED}', '${CUSTOMER}', '${LIVE}', 'placed'),
  ('${CANCELLED}', '${CUSTOMER}', '${LIVE}', 'cancelled');
insert into public.active_deals values ('${id(900)}', '${LIVE}', 'flash', 'Kopi deal', now() + interval '1 hour');
`;

async function freshDb(withPostalSector = true): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(schema(withPostalSector));
  return db;
}

/** Runs fn as `role` (and, when given, as signed-in user `uid`), inside a rolled-back transaction. */
async function as<T>(db: PGlite, role: "anon" | "authenticated", uid: string | null, fn: () => Promise<T>): Promise<T> {
  return rolledBack(db, async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    await db.exec(`set local role ${role}`);
    return fn();
  });
}

describe("docs/supabase-kitchen-privacy.sql", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDb();
    await db.exec(PRIVACY_SQL);
  });
  afterAll(async () => {
    await db.close();
  });

  it("hides PayNow, coordinates and acknowledged_terms_at from signed-out visitors", async () => {
    for (const column of HIDDEN_COLUMNS) {
      const error = await as(db, "anon", null, () => attempt(db, `select ${column} from public.kitchens`));
      expect(error, column).toMatch(/permission denied/);
    }
  });

  it("grants anon exactly the public column list", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'kitchens' and grantee = 'anon' and privilege_type = 'SELECT'`
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual([...PUBLIC_COLUMNS].sort());
  });

  it("still lets signed-out visitors read the public columns of live kitchens only", async () => {
    const { rows } = await as(db, "anon", null, () => db.query<{ id: string }>(`select ${PUBLIC_COLUMNS.join(", ")} from public.kitchens`));
    expect(rows.map((r) => r.id)).toEqual([LIVE]);
  });

  it("makes select * fail for signed-out visitors (why the app never uses it on kitchens)", async () => {
    const error = await as(db, "anon", null, () => attempt(db, "select * from public.kitchens"));
    expect(error).toMatch(/permission denied/);
  });

  it("keeps the menu readable: the menu_items policy still reads kitchens.is_live as anon", async () => {
    const { rows } = await as(db, "anon", null, () => db.query<{ name: string }>("select name from public.menu_items"));
    expect(rows.map((r) => r.name)).toEqual(["Laksa"]);
  });

  it("leaves signed-in users (Partner app cooks and admins) unchanged — Phase 2", async () => {
    const { rows } = await as(db, "authenticated", CUSTOMER, () => db.query<{ paynow_value: string }>("select paynow_value from public.kitchens"));
    expect(rows).toEqual([{ paynow_value: "91234567" }]);
  });

  it("kitchen_public_locations gives live kitchens rounded to 2 decimals", async () => {
    const { rows } = await as(db, "anon", null, () =>
      db.query<{ kitchen_id: string; latitude: string; longitude: string }>("select kitchen_id, latitude::text, longitude::text from public.kitchen_public_locations")
    );
    expect(rows).toEqual([{ kitchen_id: LIVE, latitude: "1.350000", longitude: "103.880000" }]);
  });

  it("hero_candidates rounds coordinates too, for deals and new kitchens", async () => {
    const { rows } = await as(db, "anon", null, () =>
      db.query<{ slide_kind: string; latitude: string; longitude: string }>(
        "select slide_kind, latitude::text, longitude::text from public.hero_candidates order by slide_kind"
      )
    );
    expect(rows).toEqual([
      { slide_kind: "flash", latitude: "1.350000", longitude: "103.880000" },
      { slide_kind: "new_kitchen", latitude: "1.350000", longitude: "103.880000" },
    ]);
  });

  describe("get_order_paynow", () => {
    const paynow = (uid: string | null, orderId: string) =>
      as(db, "authenticated", uid, () => db.query("select * from public.get_order_paynow($1)", [orderId]).then((r) => r.rows));

    it("returns the cook's PayNow to the customer of an accepted order", async () => {
      expect(await paynow(CUSTOMER, ACCEPTED)).toEqual([{ paynow_type: "mobile", paynow_value: "91234567" }]);
    });

    it("returns nothing for a placed or cancelled order", async () => {
      expect(await paynow(CUSTOMER, PLACED)).toEqual([]);
      expect(await paynow(CUSTOMER, CANCELLED)).toEqual([]);
    });

    it("returns nothing for someone else's order, or with no signed-in user", async () => {
      expect(await paynow(STRANGER, ACCEPTED)).toEqual([]);
      expect(await paynow(null, ACCEPTED)).toEqual([]);
    });

    it("can't be called signed out", async () => {
      const error = await as(db, "anon", null, () => attempt(db, "select * from public.get_order_paynow($1)", [ACCEPTED]));
      expect(error).toMatch(/permission denied/);
    });
  });

  it("is safe to re-run", async () => {
    await db.exec(PRIVACY_SQL);
    const error = await as(db, "anon", null, () => attempt(db, "select paynow_value from public.kitchens"));
    expect(error).toMatch(/permission denied/);
  });
});

describe("docs/supabase-kitchen-privacy.sql on a database missing a listed column", () => {
  it("stops before changing anything", async () => {
    const db = await freshDb(false);
    let message = "";
    try {
      await db.exec(PRIVACY_SQL);
    } catch (e) {
      message = (e as Error).message;
    }
    await db.exec("rollback");
    expect(message).toContain("kitchen_privacy: missing kitchens column(s): postal_sector");

    // Old behaviour intact: anon can still read the whole row, and nothing new was created.
    const { rows } = await as(db, "anon", null, () => db.query<{ paynow_value: string }>("select paynow_value from public.kitchens"));
    expect(rows).toEqual([{ paynow_value: "91234567" }]);
    const { rows: created } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname = 'get_order_paynow'`
    );
    expect(created[0].n).toBe(0);
    const { rows: views } = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.views where table_name in ('kitchen_public_locations', 'hero_candidates')`
    );
    expect(views[0].n).toBe(0);
    await db.close();
  });
});
