import { describe, it, expect, vi, beforeEach } from "vitest";
import { placeOrder } from "@/lib/order-actions";
import { quoteOrderPricing } from "@/lib/pricing-actions";
import { hasValidOptionIds, parseOrderPricing, toRpcItems } from "@/lib/order-pricing";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodePostalCode } from "@/lib/geocode";
import { createFakeDb } from "./helpers/fake-db-supabase";
import { createFakeAdmin, PLACE_ORDER_MISSING, type RpcCall, type RpcResult } from "./helpers/fake-admin";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

/** Customer side of add-ons (docs/supabase-addons.sql; the SQL itself is tested in addons-sql.test.ts). */

const REQUEST_ID = "3b9e2c1a-5d4f-4e6a-9b8c-7d6e5f4a3b2c";
const DELIVERY = { deliveryType: "normal" as const, postalCode: "310123" };
const HOT = "00000000-0000-4000-8000-000000000103";
const EGG = "00000000-0000-4000-8000-000000000105";

function useDb() {
  const db = createFakeDb((op) => {
    if (op.table === "kitchens") return { data: { id: "k1", is_live: true, is_blocked: false } };
    if (op.table === "menu_items") return { data: [{ id: "m1", name: "Laksa", price: 6.5 }, { id: "m2", name: "Kopi", price: 1.8 }] };
    if (op.table === "orders") return { data: { id: "order-old" } };
    return {};
  });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  return db;
}

function useAdmin(respond?: (call: RpcCall) => RpcResult) {
  const admin = createFakeAdmin(respond);
  vi.mocked(createAdminClient).mockReturnValue(admin.client as never);
  return admin;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(geocodePostalCode)
    .mockReset()
    .mockResolvedValue({ ok: true, lat: 1.337, lng: 103.845, address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123" });
});

describe("toRpcItems", () => {
  it("sends option_ids only on lines with picks, and never a price", () => {
    const items = [
      { menuItemId: "m1", quantity: 2, optionIds: [HOT, EGG], price: 0.01, options_price: 0 },
      { menuItemId: "m2", quantity: 1, optionIds: [] },
      { menuItemId: "m2", quantity: 3 },
    ];
    expect(toRpcItems(items as never)).toEqual([
      { menu_item_id: "m1", quantity: 2, option_ids: [HOT, EGG] },
      { menu_item_id: "m2", quantity: 1 },
      { menu_item_id: "m2", quantity: 3 },
    ]);
  });
});

describe("hasValidOptionIds", () => {
  it("accepts none, [] and distinct UUIDs", () => {
    expect(hasValidOptionIds({})).toBe(true);
    expect(hasValidOptionIds({ optionIds: [] })).toBe(true);
    expect(hasValidOptionIds({ optionIds: [HOT, EGG] })).toBe(true);
  });

  it("refuses duplicates (no quantity per option), non-UUIDs, non-lists and too many", () => {
    expect(hasValidOptionIds({ optionIds: [HOT, HOT.toUpperCase()] })).toBe(false);
    expect(hasValidOptionIds({ optionIds: ["hot"] })).toBe(false);
    expect(hasValidOptionIds({ optionIds: HOT as never })).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(hasValidOptionIds({ optionIds: many })).toBe(false);
  });
});

describe("placeOrder with add-ons", () => {
  it("passes the picks to place_order as option ids only", async () => {
    useDb();
    const admin = useAdmin();
    const result = await placeOrder("k1", [{ menuItemId: "m1", quantity: 2, optionIds: [HOT, EGG] }, { menuItemId: "m2", quantity: 1 }], DELIVERY, {
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ ok: true, orderId: "order-1" });
    expect(admin.calls[0].args.p_items).toEqual([
      { menu_item_id: "m1", quantity: 2, option_ids: [HOT, EGG] },
      { menu_item_id: "m2", quantity: 1 },
    ]);
  });

  it("a cart without add-ons sends exactly the old p_items", async () => {
    useDb();
    const admin = useAdmin();
    await placeOrder("k1", [{ menuItemId: "m1", quantity: 2 }, { menuItemId: "m2", quantity: 1, optionIds: [] }], DELIVERY, { requestId: REQUEST_ID });
    expect(admin.calls[0].args.p_items).toEqual([
      { menu_item_id: "m1", quantity: 2 },
      { menu_item_id: "m2", quantity: 1 },
    ]);
  });

  it("refuses malformed picks before calling the database", async () => {
    useDb();
    const admin = useAdmin();
    const result = await placeOrder("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT, HOT] }], DELIVERY, { requestId: REQUEST_ID });
    expect(result).toEqual({ ok: false, message: "One of your add-ons is no longer available. Please check your choices." });
    expect(admin.calls).toHaveLength(0);
  });

  const ERRORS: [string, string][] = [
    ["option_sold_out", "One of the add-ons you picked has just sold out. Please check your choices."],
    ["option_required_missing", "Please make a choice for every required option."],
    ["option_too_many", "You've picked too many options for one of your dishes."],
    ["option_not_for_item", "One of your add-ons is no longer available. Please check your choices."],
    ["invalid_option", "One of your add-ons is no longer available. Please check your choices."],
    ["order_too_large", "This order is too large. Please split it into smaller orders."],
  ];
  for (const [code, message] of ERRORS) {
    it(`shows a friendly message for ${code}`, async () => {
      useDb();
      useAdmin(() => ({ error: { code: "P0001", message: code } }));
      const result = await placeOrder("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT] }], DELIVERY, { requestId: REQUEST_ID });
      expect(result).toEqual({ ok: false, message });
    });
  }

  it("never places add-ons through the old insert (SQL not run yet): refuses instead of dropping them", async () => {
    const db = useDb();
    useAdmin(() => ({ error: PLACE_ORDER_MISSING }));
    const result = await placeOrder("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT] }], DELIVERY, { requestId: REQUEST_ID });
    expect(result).toEqual({ ok: false, message: "Add-ons aren't available yet. Please remove them and try again." });
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("the same refusal without the service-role key", async () => {
    const db = useDb();
    vi.mocked(createAdminClient).mockReturnValue(null);
    const result = await placeOrder("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT] }], DELIVERY, { requestId: REQUEST_ID });
    expect(result).toEqual({ ok: false, message: "Add-ons aren't available yet. Please remove them and try again." });
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });
});

describe("quoteOrderPricing with add-ons", () => {
  const rpc = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  });

  it("sends the picks and reads the add-ons' share", async () => {
    rpc.mockResolvedValue({ data: { subtotal: 20, options_subtotal: 7, discount_total: 2.6, food_total: 17.4, promotion_label: "20% off" }, error: null });
    const pricing = await quoteOrderPricing("k1", [{ menuItemId: "m1", quantity: 2, optionIds: [HOT, EGG] }]);
    expect(rpc).toHaveBeenCalledWith("quote_order_pricing", { p_kitchen_id: "k1", p_items: [{ menu_item_id: "m1", quantity: 2, option_ids: [HOT, EGG] }] });
    expect(pricing).toEqual({ subtotal: 20, optionsSubtotal: 7, discountTotal: 2.6, foodTotal: 17.4, promotionLabel: "20% off" });
  });

  it("says which add-on rule failed, so the cart can hold checkout", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "option_sold_out" } });
    await expect(quoteOrderPricing("k1", [{ menuItemId: "m1", quantity: 1, optionIds: [HOT] }])).resolves.toEqual({
      addOnProblem: "One of the add-ons you picked has just sold out. Please check your choices.",
    });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "kitchen_unavailable" } });
    await expect(quoteOrderPricing("k1", [{ menuItemId: "m1", quantity: 1 }])).resolves.toBeNull();
  });

  it("is null for malformed picks, without asking the database", async () => {
    await expect(quoteOrderPricing("k1", [{ menuItemId: "m1", quantity: 1, optionIds: ["x"] }])).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("parseOrderPricing", () => {
  it("leaves optionsSubtotal out when there are no add-ons, so the result is the same as before", () => {
    const before = { subtotal: 7, discountTotal: 1.4, foodTotal: 5.6, promotionLabel: "20% off" };
    const base = { subtotal: 7, discount_total: 1.4, food_total: 5.6, promotion_label: "20% off" };
    expect(parseOrderPricing(base)).toEqual(before);
    expect(parseOrderPricing({ ...base, dish_subtotal: 7, options_subtotal: 0 })).toEqual(before);
    expect(parseOrderPricing({ ...base, options_subtotal: "not a number" })).toEqual(before);
  });
});
