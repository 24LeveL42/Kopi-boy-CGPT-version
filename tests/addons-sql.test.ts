// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ADDONS_SQL,
  attempt,
  commentedStatement,
  computePricing,
  createPricingDb,
  errorOf,
  id,
  rolledBack,
  type PricingResult,
} from "./helpers/pricing-db";

/**
 * docs/supabase-addons.sql, run for real (PGlite) on top of the real
 * docs/supabase-promotions.sql pricing. "old" is the database before the
 * add-ons migration, "new" after it.
 */

// Kitchens
const K1 = id(1); // live
const K2 = id(2); // live, another cook
const K3 = id(3); // not live
const CUSTOMER = id(500);

// Dishes (K1 unless noted)
const LAKSA = id(11); // 6.50, groups: Spice level (required, 1), Extras (up to 3)
const KOPI = id(12); // 1.80, no groups
const TOAST = id(13); // 3.20, no groups
const NASI = id(14); // 10.00, group: Extras (optional, up to 2)
const MEE = id(15); // 4.40, no groups
const CHICKEN = id(16); // 8.00, no groups
const PRATA = id(19); // K2, 2.00, group with one option
const HIDDEN = id(20); // K3, 5.00, group with one option

// Options
const MILD = id(101), MEDIUM = id(102), HOT = id(103), VOLCANO = id(104); // Spice level, 0.00; VOLCANO sold out
const EGG = id(105), RICE = id(106), FISHCAKE = id(107), PRAWNS = id(108); // Laksa extras 1.00 / 0.50 / 1.20 / 2.50
const NASI_EGG = id(109), OTAH = id(110); // Nasi extras 1.00 / 1.50
const CHEESE = id(119); // Prata (K2) 1.00
const HIDDEN_OPT = id(120); // K3 dish's option

// Promotions on K1, all inactive until a scenario switches them on.
const PROMOS = {
  percent: id(201), // percent_off 20
  amount: id(202), // amount_off 3.00
  bxgy: id(203), // buy 2 get 1
  free: id(204), // free_item KOPI, min_spend 5
  minSpend: id(205), // min_spend 30, 10% off
  limited: id(206), // limited_qty deal_price 5.00, 3 portions, items NASI + CHICKEN
  flash: id(207), // flash amount_off 1.00, 2 portions
  percentItems: id(208), // percent_off 30 on CHICKEN only
  bigAmount: id(209), // amount_off 50
  freeNasi: id(210), // free_item NASI
};
type PromoKey = keyof typeof PROMOS;

const BASE_SEED = `
insert into public.kitchens (id, is_live) values ('${K1}', true), ('${K2}', true), ('${K3}', false);
insert into public.menu_items (id, kitchen_id, name, price) values
  ('${LAKSA}', '${K1}', 'Laksa', 6.50), ('${KOPI}', '${K1}', 'Kopi', 1.80), ('${TOAST}', '${K1}', 'Kaya Toast', 3.20),
  ('${NASI}', '${K1}', 'Nasi Lemak', 10.00), ('${MEE}', '${K1}', 'Mee Rebus', 4.40), ('${CHICKEN}', '${K1}', 'Chicken Rice', 8.00),
  ('${PRATA}', '${K2}', 'Prata', 2.00), ('${HIDDEN}', '${K3}', 'Hidden', 5.00);
insert into public.promotions (id, kitchen_id, kind, title, percent_off, amount_off, buy_qty, get_qty, min_spend, deal_price, free_item_id, quantity_limit, starts_at, ends_at, is_active) values
  ('${PROMOS.percent}', '${K1}', 'percent_off', '20% off', 20, null, null, null, null, null, null, null, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.amount}', '${K1}', 'amount_off', '$3 off', null, 3.00, null, null, null, null, null, null, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.bxgy}', '${K1}', 'buy_x_get_y', 'Buy 2 get 1', null, null, 2, 1, null, null, null, null, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.free}', '${K1}', 'free_item', 'Free Kopi', null, null, null, null, 5.00, null, '${KOPI}', null, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.minSpend}', '${K1}', 'min_spend', '10% over $30', 10, null, null, null, 30.00, null, null, null, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.limited}', '${K1}', 'limited_qty', '$5 plates', null, null, null, null, null, 5.00, null, 3, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.flash}', '${K1}', 'flash', 'Flash $1 off', null, 1.00, null, null, null, null, null, 2, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.percentItems}', '${K1}', 'percent_off', '30% off Chicken Rice', 30, null, null, null, null, null, null, null, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.bigAmount}', '${K1}', 'amount_off', '$50 off', null, 50.00, null, null, null, null, null, null, now() - interval '1 day', now() + interval '1 day', false),
  ('${PROMOS.freeNasi}', '${K1}', 'free_item', 'Free Nasi Lemak', null, null, null, null, null, null, '${NASI}', null, now() - interval '1 day', now() + interval '1 day', false);
insert into public.promotion_items (promotion_id, menu_item_id) values
  ('${PROMOS.limited}', '${NASI}'), ('${PROMOS.limited}', '${CHICKEN}'), ('${PROMOS.percentItems}', '${CHICKEN}');
`;

const OPTIONS_SEED = `
insert into public.menu_option_groups (id, menu_item_id, name, required, max_picks, sort_order) values
  ('${id(301)}', '${LAKSA}', 'Spice level', true, 1, 0),
  ('${id(302)}', '${LAKSA}', 'Extras', false, 3, 1),
  ('${id(303)}', '${NASI}', 'Extras', false, 2, 0),
  ('${id(309)}', '${PRATA}', 'Toppings', false, 1, 0),
  ('${id(310)}', '${HIDDEN}', 'Toppings', false, 1, 0);
insert into public.menu_options (id, group_id, name, price, sold_out, sort_order) values
  ('${MILD}', '${id(301)}', 'Mild', 0, false, 0), ('${MEDIUM}', '${id(301)}', 'Medium', 0, false, 1),
  ('${HOT}', '${id(301)}', 'Hot', 0, false, 2), ('${VOLCANO}', '${id(301)}', 'Volcano', 0, true, 3),
  ('${EGG}', '${id(302)}', 'Extra egg', 1.00, false, 0), ('${RICE}', '${id(302)}', 'Extra rice', 0.50, false, 1),
  ('${FISHCAKE}', '${id(302)}', 'Fishcake', 1.20, false, 2), ('${PRAWNS}', '${id(302)}', 'Prawns', 2.50, false, 3),
  ('${NASI_EGG}', '${id(303)}', 'Egg', 1.00, false, 0), ('${OTAH}', '${id(303)}', 'Otah', 1.50, false, 1),
  ('${CHEESE}', '${id(309)}', 'Cheese', 1.00, false, 0),
  ('${HIDDEN_OPT}', '${id(310)}', 'Secret', 1.00, false, 0);
`;

let oldDb: PGlite;
let newDb: PGlite;

beforeAll(async () => {
  [oldDb, newDb] = await Promise.all([createPricingDb("old"), createPricingDb("new")]);
  await oldDb.exec(BASE_SEED);
  await newDb.exec(BASE_SEED + OPTIONS_SEED);
}, 120_000);

afterAll(async () => {
  await Promise.all([oldDb?.close(), newDb?.close()]);
});

async function activate(db: PGlite, keys: PromoKey[]) {
  await db.query("update public.promotions set is_active = (id = any($1::uuid[]))", [keys.map((k) => PROMOS[k])]);
}

const line = (menuItemId: string, quantity: number, optionIds?: string[]) => ({
  menu_item_id: menuItemId,
  quantity,
  ...(optionIds ? { option_ids: optionIds } : {}),
});

/** Only what existed before add-ons, in a stable order, for old-vs-new comparison. */
function comparable(r: PricingResult) {
  return {
    subtotal: r.subtotal,
    discount_total: r.discount_total,
    food_total: r.food_total,
    promotion_id: r.promotion_id,
    promotion_kind: r.promotion_kind,
    promotion_label: r.promotion_label,
    promotion_units: r.promotion_units,
    lines: r.lines.map((l) => ({
      menu_item_id: l.menu_item_id,
      name: l.name,
      price: l.price,
      quantity: l.quantity,
      discount_amount: l.discount_amount,
    })),
  };
}

const cents = (n: number) => Math.round(n * 100);
const sumCents = (ns: number[]) => ns.reduce((s, n) => s + cents(n), 0);

const SCENARIOS: PromoKey[][] = [
  [],
  ["percent"],
  ["amount"],
  ["bxgy"],
  ["free"],
  ["minSpend"],
  ["limited"],
  ["flash"],
  ["percentItems"],
  ["bigAmount"],
  ["freeNasi"],
  Object.keys(PROMOS) as PromoKey[],
];

// Dishes without a required group, sent the old way (no option_ids).
const NO_ADDON_CARTS = [
  [line(KOPI, 1)],
  [line(KOPI, 2), line(TOAST, 1)],
  [line(TOAST, 1), line(KOPI, 2), line(TOAST, 2)], // duplicate dish lines merge
  [line(KOPI, 1), line(TOAST, 1), line(NASI, 2), line(MEE, 5)],
  [line(NASI, 3)],
  [line(CHICKEN, 2), line(NASI, 1), line(MEE, 1)],
  [line(KOPI, 4), line(CHICKEN, 4)],
  [line(MEE, 99)],
];

describe("migration", () => {
  it("applies on top of promotions PART 2 and can be run again", async () => {
    // A second run, as the owner might do by accident (the file has its own begin/commit).
    await newDb.exec(ADDONS_SQL);
    const { rows } = await newDb.query<{ n: number }>(
      "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'promotion_eligible_lines'"
    );
    expect(rows[0].n).toBe(1);
  });

  it("wraps everything in one transaction, with promotion_eligible_lines dropped and every caller recreated inside it", () => {
    const body = ADDONS_SQL.replace(/^\s*--.*$/gm, "");
    const begin = body.indexOf("begin;");
    const commit = body.indexOf("commit;");
    const drop = body.indexOf("drop function if exists private.promotion_eligible_lines");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("begin;", begin + 1)).toBe(-1);
    expect(commit).toBeGreaterThan(begin);
    for (const name of [
      drop,
      body.indexOf("create function private.promotion_eligible_lines"),
      body.indexOf("create or replace function private.promotion_discounts"),
      body.indexOf("create or replace function public.compute_order_pricing"),
      body.indexOf("create or replace function public.place_order"),
    ]) {
      expect(name).toBeGreaterThan(begin);
      expect(name).toBeLessThan(commit);
    }
    // Nothing executable after commit: the verification section is all comments.
    expect(body.slice(commit + "commit;".length).trim()).toBe("");
  });
});

describe("a cart with no add-ons prices exactly as before", () => {
  it("compute_order_pricing: same numbers and lines for every deal kind", async () => {
    for (const scenario of SCENARIOS) {
      await activate(oldDb, scenario);
      await activate(newDb, scenario);
      for (const cart of NO_ADDON_CARTS) {
        const before = await computePricing(oldDb, K1, cart, CUSTOMER);
        const after = await computePricing(newDb, K1, cart, CUSTOMER);
        expect({ scenario, cart, pricing: comparable(after) }).toEqual({ scenario, cart, pricing: comparable(before) });
        expect(after.options_subtotal).toBe(0);
        expect(after.dish_subtotal).toBe(after.subtotal);
      }
    }
  });

  it("an empty option_ids list is the same as none", async () => {
    await activate(newDb, ["percent"]);
    const plain = await computePricing(newDb, K1, [line(NASI, 2), line(KOPI, 1)]);
    const empty = await computePricing(newDb, K1, [line(NASI, 2, []), line(KOPI, 1, [])]);
    expect(empty).toEqual(plain);
  });

  it("place_order: same order row and order_items as before", async () => {
    await activate(oldDb, Object.keys(PROMOS) as PromoKey[]);
    await activate(newDb, Object.keys(PROMOS) as PromoKey[]);
    const cart = [line(CHICKEN, 2), line(NASI, 1), line(KOPI, 3)];
    const place = async (db: PGlite) =>
      rolledBack(db, async () => {
        const { rows } = await db.query<{ r: { order_id: string } }>(
          "select public.place_order($1, $2, $3::jsonb, $4::jsonb) as r",
          [CUSTOMER, K1, JSON.stringify(cart), JSON.stringify({ delivery_type: "normal", lat: 1.3, lng: 103.8 })]
        );
        const orderId = rows[0].r.order_id;
        const order = await db.query("select subtotal, discount_total, food_total, promotion_id, promotion_kind, promotion_units, delivery_fee_estimate from public.orders where id = $1", [orderId]);
        const items = await db.query("select menu_item_id, name, price, quantity, discount_amount from public.order_items where order_id = $1 order by menu_item_id", [orderId]);
        const claimed = await db.query("select id, quantity_claimed from public.promotions order by id");
        return { result: { ...rows[0].r, order_id: undefined }, order: order.rows, items: items.rows, claimed: claimed.rows };
      });
    expect(await place(newDb)).toEqual(await place(oldDb));
  });
});

describe("two lines of the same dish", () => {
  const SAME_DISH_CARTS = [
    [line(LAKSA, 2, [MILD]), line(LAKSA, 1, [HOT, EGG])],
    [line(LAKSA, 3, [MEDIUM, EGG, RICE, FISHCAKE]), line(LAKSA, 1, [MILD]), line(LAKSA, 2, [HOT, PRAWNS])],
    [line(NASI, 1, [NASI_EGG]), line(NASI, 2), line(NASI, 1, [NASI_EGG, OTAH]), line(CHICKEN, 2)],
    [line(KOPI, 1), line(LAKSA, 1, [MILD]), line(LAKSA, 1, [MILD, EGG]), line(NASI, 2, [OTAH]), line(NASI, 1)],
  ];

  it("stay separate lines, and their discounts always add up to discount_total", async () => {
    for (const scenario of SCENARIOS) {
      await activate(newDb, scenario);
      for (const cart of SAME_DISH_CARTS) {
        const r = await computePricing(newDb, K1, cart, CUSTOMER);
        const label = JSON.stringify({ scenario, cart });
        expect(r.lines, label).toHaveLength(cart.length);
        expect(sumCents(r.lines.map((l) => l.discount_amount)), label).toBe(cents(r.discount_total));
        for (const l of r.lines) {
          // A line's discount never exceeds its DISH value (add-ons are never discounted).
          expect(cents(l.discount_amount), label).toBeLessThanOrEqual(cents(l.price * l.quantity));
          expect(l.discount_amount, label).toBeGreaterThanOrEqual(0);
        }
        expect(cents(r.subtotal), label).toBe(cents(r.dish_subtotal!) + cents(r.options_subtotal!));
        expect(cents(r.food_total), label).toBe(cents(r.subtotal) - cents(r.discount_total));
        expect(cents(r.discount_total), label).toBeLessThanOrEqual(cents(r.dish_subtotal!));
      }
    }
  });

  it("identical picks merge into one line, in any order", async () => {
    const r = await computePricing(newDb, K1, [line(LAKSA, 1, [EGG, HOT]), line(LAKSA, 2, [HOT, EGG])]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].quantity).toBe(3);
  });
});

describe("deals see dish prices only", () => {
  it("the add-ons' prices never change the deal", async () => {
    for (const scenario of SCENARIOS) {
      await activate(newDb, scenario);
      // Same lines and dishes; only the add-on prices differ (Mild/Hot are free, Prawns/Egg aren't).
      const cheap = await computePricing(newDb, K1, [line(LAKSA, 2, [MILD]), line(LAKSA, 1, [HOT]), line(NASI, 2)]);
      const dear = await computePricing(newDb, K1, [line(LAKSA, 2, [MILD, PRAWNS]), line(LAKSA, 1, [HOT, EGG]), line(NASI, 2, [OTAH])]);
      const label = JSON.stringify(scenario);
      expect(dear.discount_total, label).toBe(cheap.discount_total);
      expect(dear.lines.map((l) => l.discount_amount), label).toEqual(cheap.lines.map((l) => l.discount_amount));
      expect(dear.promotion_id, label).toBe(cheap.promotion_id);
      expect(dear.subtotal, label).toBeGreaterThan(cheap.subtotal);
    }
  });

  it("percent off: 20% of the dish, add-ons charged in full", async () => {
    await activate(newDb, ["percent"]);
    const r = await computePricing(newDb, K1, [line(NASI, 1, [NASI_EGG, OTAH])]);
    expect(r).toMatchObject({ subtotal: 12.5, dish_subtotal: 10, options_subtotal: 2.5, discount_total: 2, food_total: 10.5 });
    expect(r.lines[0]).toMatchObject({ price: 10, options_price: 2.5, discount_amount: 2 });
  });

  it("min spend counts dishes only: $28 of dishes + $5 of add-ons doesn't reach $30", async () => {
    await activate(newDb, ["minSpend"]);
    const r = await computePricing(newDb, K1, [line(NASI, 2, [NASI_EGG, OTAH]), line(CHICKEN, 1)]);
    expect(r).toMatchObject({ subtotal: 33, dish_subtotal: 28, discount_total: 0, food_total: 33, promotion_id: null });
    const reached = await computePricing(newDb, K1, [line(NASI, 2, [NASI_EGG, OTAH]), line(CHICKEN, 2)]);
    expect(reached).toMatchObject({ dish_subtotal: 36, subtotal: 41, discount_total: 3.6, food_total: 37.4 });
  });

  it("the discount cap is the dish subtotal: $50 off a $10 dish with $2.50 of add-ons leaves the add-ons to pay", async () => {
    await activate(newDb, ["bigAmount"]);
    const r = await computePricing(newDb, K1, [line(NASI, 1, [NASI_EGG, OTAH])]);
    expect(r).toMatchObject({ subtotal: 12.5, discount_total: 10, food_total: 2.5 });
  });

  it("free item: one unit of the dish is free, its add-ons are not", async () => {
    await activate(newDb, ["freeNasi"]);
    const r = await computePricing(newDb, K1, [line(NASI, 1, [OTAH]), line(NASI, 1)]);
    expect(r).toMatchObject({ subtotal: 21.5, discount_total: 10, food_total: 11.5 });
    expect(r.lines.map((l) => l.discount_amount)).toEqual([10, 0]);
  });

  it("buy 2 get 1: the free unit is the cheapest dish, its add-ons still paid", async () => {
    await activate(newDb, ["bxgy"]);
    const r = await computePricing(newDb, K1, [line(LAKSA, 2, [MILD]), line(KOPI, 1)]);
    // Kopi 1.80 is the cheapest of 3 units.
    expect(r).toMatchObject({ subtotal: 14.8, discount_total: 1.8, food_total: 13 });
    const withAddOns = await computePricing(newDb, K1, [line(LAKSA, 2, [MILD, PRAWNS]), line(LAKSA, 1, [HOT])]);
    // Three Laksa at 6.50: one is free (6.50), Prawns on two of them are paid.
    expect(withAddOns).toMatchObject({ subtotal: 24.5, discount_total: 6.5, food_total: 18 });
  });
});

describe("option checks", () => {
  const cases: [string, unknown[], string][] = [
    ["sold out", [line(LAKSA, 1, [VOLCANO])], "option_sold_out"],
    ["required group missing", [line(LAKSA, 1, [EGG])], "option_required_missing"],
    ["required group missing, no option_ids at all", [line(LAKSA, 1)], "option_required_missing"],
    ["two picks in a pick-1 group", [line(LAKSA, 1, [MILD, HOT])], "option_too_many"],
    ["four picks in a pick-3 group", [line(LAKSA, 1, [MILD, EGG, RICE, FISHCAKE, PRAWNS])], "option_too_many"],
    ["another dish's option", [line(NASI, 1, [EGG])], "option_not_for_item"],
    ["another kitchen's option", [line(NASI, 1, [CHEESE])], "option_not_for_item"],
    ["an option that doesn't exist", [line(NASI, 1, [id(999)])], "option_not_for_item"],
    ["the same option twice", [line(NASI, 1, [OTAH, OTAH])], "invalid_option"],
    ["not a uuid", [line(NASI, 1, ["otah"])], "invalid_option"],
    ["not a list", [{ menu_item_id: NASI, quantity: 1, option_ids: OTAH }], "invalid_option"],
    ["another kitchen's dish", [line(PRATA, 1, [CHEESE])], "item_unavailable"],
  ];

  for (const [name, cart, code] of cases) {
    it(`refuses ${name} (${code})`, async () => {
      expect(await errorOf(computePricing(newDb, K1, cart))).toBe(code);
    });
  }

  it("accepts every valid pick, prices come from the database", async () => {
    const r = await computePricing(newDb, K1, [
      { ...line(LAKSA, 2, [HOT, EGG, PRAWNS]), price: 0.01, options_price: 0 },
    ]);
    expect(r.lines[0]).toMatchObject({ price: 6.5, options_price: 3.5, quantity: 2 });
    expect(r.lines[0].options!.map((o) => [o.group_name, o.name, o.price])).toEqual([
      ["Spice level", "Hot", 0],
      ["Extras", "Extra egg", 1],
      ["Extras", "Prawns", 2.5],
    ]);
    expect(r).toMatchObject({ subtotal: 20, dish_subtotal: 13, options_subtotal: 7 });
  });

  it("an order too big for orders.subtotal is refused clearly", async () => {
    await rolledBack(newDb, async () => {
      await newDb.query("update public.menu_items set price = 9999 where id = $1", [CHICKEN]);
      expect(await errorOf(computePricing(newDb, K1, [line(CHICKEN, 11)]))).toBe("order_too_large");
    });
  });
});

describe("place_order with add-ons", () => {
  const DELIVERY = JSON.stringify({ delivery_type: "normal", lat: 1.3, lng: 103.8 });

  it("charges the add-ons, snapshots them, and old orders survive menu edits", async () => {
    await activate(newDb, ["percent"]);
    const cart = [line(LAKSA, 2, [HOT, EGG]), line(LAKSA, 1, [MILD]), line(KOPI, 1)];
    // Dishes 6.50*3 + 1.80 = 21.30, add-ons 1.00*2 = 2.00, 20% of the dishes only = 4.26.
    // A customer shown the total without the add-ons (19.04 - 2.00 = 17.04) is refused, not undercharged.
    await rolledBack(newDb, async () => {
      const err = await errorOf(
        newDb.query("select public.place_order($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)", [
          CUSTOMER,
          K1,
          JSON.stringify(cart),
          DELIVERY,
          JSON.stringify({ food_total: 17.04, delivery_fee: 3.3 }),
        ])
      );
      expect(err).toBe("pricing_changed");
    });

    await rolledBack(newDb, async () => {
      const { rows } = await newDb.query<{ r: { order_id: string } }>(
        "select public.place_order($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) as r",
        [CUSTOMER, K1, JSON.stringify(cart), DELIVERY, JSON.stringify({ food_total: 19.04, delivery_fee: 3.3 })]
      );
      const orderId = rows[0].r.order_id;
      const order = await newDb.query("select subtotal, discount_total, food_total from public.orders where id = $1", [orderId]);
      expect(order.rows[0]).toEqual({ subtotal: "23.30", discount_total: "4.26", food_total: "19.04" });

      const items = await newDb.query(
        "select name, price, quantity, options_price, discount_amount from public.order_items where order_id = $1 order by name, quantity desc",
        [orderId]
      );
      expect(items.rows).toEqual([
        { name: "Kopi", price: "1.80", quantity: 1, options_price: "0.00", discount_amount: "0.36" },
        { name: "Laksa", price: "6.50", quantity: 2, options_price: "1.00", discount_amount: "2.60" },
        { name: "Laksa", price: "6.50", quantity: 1, options_price: "0.00", discount_amount: "1.30" },
      ]);

      const snapshot = () =>
        newDb.query(
          `select i.quantity, o.option_id, o.group_name, o.name, o.price, o.sort_order
           from public.order_item_options o join public.order_items i on i.id = o.order_item_id
           where i.order_id = $1 order by i.quantity desc, o.sort_order`,
          [orderId]
        );
      expect((await snapshot()).rows).toEqual([
        { quantity: 2, option_id: HOT, group_name: "Spice level", name: "Hot", price: "0.00", sort_order: 1 },
        { quantity: 2, option_id: EGG, group_name: "Extras", name: "Extra egg", price: "1.00", sort_order: 2 },
        { quantity: 1, option_id: MILD, group_name: "Spice level", name: "Mild", price: "0.00", sort_order: 1 },
      ]);

      // The cook renames and reprices, then deletes the option: the order keeps what was charged.
      await newDb.query("update public.menu_options set name = 'Two eggs', price = 2.00 where id = $1", [EGG]);
      await newDb.query("update public.menu_option_groups set name = 'Add more' where id = $1", [id(302)]);
      await newDb.query("delete from public.menu_options where id = $1", [EGG]);
      expect((await snapshot()).rows[1]).toEqual({ quantity: 2, option_id: null, group_name: "Extras", name: "Extra egg", price: "1.00", sort_order: 2 });
    });
  });

  it("refuses an option that sold out, and creates nothing", async () => {
    await rolledBack(newDb, async () => {
      await newDb.query("update public.menu_options set sold_out = true where id = $1", [HOT]);
      const before = await newDb.query<{ n: number }>("select count(*)::int as n from public.orders");
      const err = await attempt(newDb, "select public.place_order($1, $2, $3::jsonb, $4::jsonb)", [
        CUSTOMER,
        K1,
        JSON.stringify([line(LAKSA, 1, [HOT])]),
        DELIVERY,
      ]);
      expect(err).toBe("option_sold_out");
      const after = await newDb.query<{ n: number }>("select count(*)::int as n from public.orders");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });
});

describe("who may read and write", () => {
  async function as(role: "anon" | "authenticated", uid: string | null, fn: () => Promise<unknown>) {
    await rolledBack(newDb, async () => {
      await newDb.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
      await newDb.exec(`set local role ${role}`);
      await fn();
    });
  }

  it("anyone reads a live kitchen's options, not a hidden kitchen's", async () => {
    await as("anon", null, async () => {
      const { rows } = await newDb.query<{ id: string }>("select id from public.menu_options");
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(EGG);
      expect(ids).toContain(CHEESE);
      expect(ids).not.toContain(HIDDEN_OPT);
    });
  });

  it("anon can't write options", async () => {
    await as("anon", null, async () => {
      expect(await errorOf(newDb.query("update public.menu_options set price = 0"))).toMatch(/permission denied/);
    });
  });

  it("a cook writes their own dishes' options only", async () => {
    await as("authenticated", K2, async () => {
      await newDb.query("insert into public.menu_option_groups (menu_item_id, name) values ($1, 'Sauce')", [PRATA]);
      expect(await attempt(newDb, "insert into public.menu_option_groups (menu_item_id, name) values ($1, 'Sauce')", [NASI])).toMatch(
        /row-level security/
      );
      const updated = await newDb.query("update public.menu_options set price = 0 where id = $1", [EGG]);
      expect(updated.affectedRows).toBe(0);
      // Can't move their own option onto another kitchen's group either.
      expect(await attempt(newDb, "update public.menu_options set group_id = $1 where id = $2", [id(303), CHEESE])).toMatch(
        /row-level security/
      );
    });
  });

  it("nobody but place_order writes order_item_options", async () => {
    await as("authenticated", CUSTOMER, async () => {
      expect(
        await errorOf(newDb.query("insert into public.order_item_options (order_item_id, group_name, name, price) values (gen_random_uuid(), 'x', 'x', 0)"))
      ).toMatch(/permission denied/);
    });
  });
});

describe("the file's READ-ONLY verification queries", () => {
  it("(a) gives the same fingerprint before and after the migration", async () => {
    const query = commentedStatement(ADDONS_SQL, "with kitchen_carts as (");
    expect(query).not.toMatch(/\b(insert|update|delete)\b/i);
    for (const scenario of SCENARIOS) {
      await activate(oldDb, scenario);
      await activate(newDb, scenario);
      const before = await oldDb.query<{ kitchen_id: string; pricing: string }>(query);
      // As it is straight after the migration: no cook has added option groups yet.
      const after = await rolledBack(newDb, async () => {
        await newDb.exec("delete from public.menu_option_groups");
        return newDb.query<{ kitchen_id: string; pricing: string }>(query);
      });
      expect(after.rows.length).toBeGreaterThan(1);
      expect(after.rows.at(-1)!.kitchen_id).toBe("FINGERPRINT");
      expect(after.rows).toEqual(before.rows);
    }
  });

  it("(b) security definer and EXECUTE are as the file says", async () => {
    const { rows } = await newDb.query<Record<string, unknown>>(commentedStatement(ADDONS_SQL, "select n.nspname || '.' || p.proname as function,"));
    const byName = Object.fromEntries(rows.map((r) => [r.function, r]));
    for (const fn of ["public.place_order", "public.compute_order_pricing"]) {
      expect(byName[fn]).toMatchObject({ secdef: true, config: ['search_path=""'], anon: false, authenticated: false, service_role: true });
    }
    expect(byName["public.quote_order_pricing"]).toMatchObject({ secdef: true, anon: true, authenticated: true });
    for (const fn of ["private.normalize_order_items", "private.promotion_eligible_lines", "private.promotion_discounts", "private.order_item_options_client_guard"]) {
      expect(byName[fn]).toMatchObject({ secdef: false, anon: false, authenticated: false });
    }

    const tables = await newDb.query<Record<string, unknown>>(commentedStatement(ADDONS_SQL, "select c.relname as table_name,"));
    const t = Object.fromEntries(tables.rows.map((r) => [r.table_name, r]));
    const write = { auth_insert: true, auth_update: true, auth_delete: true };
    const noAnonWrite = { anon_insert: false, anon_update: false, anon_delete: false };
    expect(t.menu_option_groups).toMatchObject({ rls: true, anon_select: true, auth_select: true, ...write, ...noAnonWrite });
    expect(t.menu_options).toMatchObject({ rls: true, anon_select: true, auth_select: true, ...write, ...noAnonWrite });
    expect(t.order_item_options).toMatchObject({
      rls: true,
      anon_select: false,
      auth_select: true,
      auth_insert: false,
      auth_update: false,
      auth_delete: false,
      ...noAnonWrite,
    });

    const policies = await newDb.query<{ tablename: string }>(commentedStatement(ADDONS_SQL, "select tablename, policyname, cmd, roles from pg_policies"));
    for (const table of ["menu_option_groups", "menu_options", "order_item_options"]) {
      expect(policies.rows.filter((p) => p.tablename === table)).toHaveLength(3);
    }
    const triggers = await newDb.query(commentedStatement(ADDONS_SQL, "select tgname from pg_trigger"));
    expect(triggers.rows).toEqual([{ tgname: "order_item_options_client_guard" }]);
  });

  it("(c) anon can't price, place or write: every column is false", async () => {
    const { rows } = await newDb.query<Record<string, boolean>>(
      commentedStatement(ADDONS_SQL, "-- select\n--   has_function_privilege('anon', 'public.compute_order_pricing(uuid, jsonb, uuid)', 'execute')")
    );
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0]).every((v) => v === false)).toBe(true);
  });
});
