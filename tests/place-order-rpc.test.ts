import { describe, it, expect, vi, beforeEach } from "vitest";
import { placeOrder } from "@/lib/order-actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodePostalCode } from "@/lib/geocode";
import { createFakeDb } from "./helpers/fake-db-supabase";
import { createFakeAdmin, PLACE_ORDER_MISSING, type RpcCall, type RpcResult } from "./helpers/fake-admin";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

const REQUEST_ID = "3b9e2c1a-5d4f-4e6a-9b8c-7d6e5f4a3b2c";
const DELIVERY = { deliveryType: "normal" as const, postalCode: "310123" };
const ITEMS = [
  { menuItemId: "m1", quantity: 2 },
  { menuItemId: "m2", quantity: 1 },
];

function useDb() {
  const db = createFakeDb((op) => {
    if (op.table === "kitchens") return { data: { id: "k1", is_live: true, is_blocked: false } };
    if (op.table === "menu_items") return { data: [{ id: "m1", name: "Kopi", price: 2 }, { id: "m2", name: "Kaya Toast", price: 3 }] };
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

const pricingChanged = (details: object | string | undefined) => ({
  error: {
    code: "P0001",
    message: "pricing_changed",
    details: typeof details === "string" || details === undefined ? details : JSON.stringify(details),
  },
});

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(geocodePostalCode)
    .mockReset()
    .mockResolvedValue({ ok: true, lat: 1.337, lng: 103.845, address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123" });
});

describe("placeOrder — through place_order", () => {
  it("calls place_order with the signed-in customer, item ids and quantities only, and the request id", async () => {
    const db = useDb();
    const admin = useAdmin();
    const result = await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID, expected: { foodTotal: 7, deliveryFee: 3.3 } });

    expect(result).toEqual({ ok: true, orderId: "order-1" });
    expect(admin.calls).toHaveLength(1);
    expect(admin.calls[0].name).toBe("place_order");
    expect(admin.calls[0].args).toEqual({
      p_customer_id: "customer-1",
      p_kitchen_id: "k1",
      p_items: [
        { menu_item_id: "m1", quantity: 2 },
        { menu_item_id: "m2", quantity: 1 },
      ],
      p_delivery: expect.objectContaining({ delivery_type: "normal", postal_code: "310123" }),
      p_expected: { food_total: 7, delivery_fee: 3.3 },
      p_request_id: REQUEST_ID,
    });
    // Prices come from menu_items inside the database, so the app doesn't even read them.
    expect(db.ops.some((o) => o.table === "menu_items")).toBe(false);
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("never sends a price, even when the browser adds one", async () => {
    useDb();
    const admin = useAdmin();
    const tampered = [{ menuItemId: "m1", quantity: 1, price: 0.01, name: "Free" }];
    await placeOrder("k1", tampered as never, DELIVERY, { requestId: REQUEST_ID });
    expect(admin.calls[0].args.p_items).toEqual([{ menu_item_id: "m1", quantity: 1 }]);
  });

  it("drops a request id that isn't a UUID, and expected numbers that aren't numbers", async () => {
    useDb();
    const admin = useAdmin();
    await placeOrder("k1", ITEMS, DELIVERY, { requestId: "'; drop table orders", expected: { foodTotal: Number.NaN, deliveryFee: 3 } });
    expect(admin.calls[0].args.p_request_id).toBeNull();
    expect(admin.calls[0].args.p_expected).toBeNull();
  });

  it("returns the same order when the same request id is sent again (place_order dedupes on it)", async () => {
    useDb();
    const placed = new Map<unknown, string>();
    const admin = useAdmin(({ args }) => {
      const existing = placed.get(args.p_request_id);
      if (existing) return { data: { order_id: existing, existing: true } };
      placed.set(args.p_request_id, `order-${placed.size + 1}`);
      return { data: { order_id: `order-${placed.size}`, existing: false } };
    });

    const first = await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID });
    const retry = await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID });
    const fresh = await placeOrder("k1", ITEMS, DELIVERY, { requestId: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f" });

    expect(first).toEqual({ ok: true, orderId: "order-1" });
    expect(retry).toEqual({ ok: true, orderId: "order-1" });
    expect(fresh).toEqual({ ok: true, orderId: "order-2" });
    expect(admin.calls.map((c) => c.args.p_request_id)).toEqual([REQUEST_ID, REQUEST_ID, "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f"]);
  });

  it("refuses a quantity over 99 before any query", async () => {
    const db = useDb();
    const admin = useAdmin();
    await expect(placeOrder("k1", [{ menuItemId: "m1", quantity: 100 }], DELIVERY)).resolves.toEqual({
      ok: false,
      message: "Invalid item quantity in cart.",
    });
    expect(db.ops).toEqual([]);
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });
});

describe("placeOrder — pricing_changed", () => {
  it("creates nothing and hands back the new numbers to confirm", async () => {
    const db = useDb();
    useAdmin(() =>
      pricingChanged({ subtotal: 7, discount_total: 0, food_total: 7, delivery_fee: 3.3, promotion_label: null })
    );
    const result = await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID, expected: { foodTotal: 5.6, deliveryFee: 3.3 } });

    expect(result).toEqual({
      ok: false,
      message: "The price of your order has changed. Please check the new total.",
      pricingChanged: { subtotal: 7, discountTotal: 0, foodTotal: 7, promotionLabel: null, deliveryFee: 3.3, total: 10.3 },
    });
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("includes the deal when the new price has one", async () => {
    useDb();
    useAdmin(() => pricingChanged({ subtotal: 7, discount_total: 1.4, food_total: 5.6, delivery_fee: 3.3, promotion_label: "20% off" }));
    const result = await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID, expected: { foodTotal: 7, deliveryFee: 3.3 } });
    expect(result).toMatchObject({ ok: false, pricingChanged: { discountTotal: 1.4, foodTotal: 5.6, total: 8.9, promotionLabel: "20% off" } });
  });

  it("still refuses, without numbers, if the details can't be read", async () => {
    useDb();
    useAdmin(() => pricingChanged("not json"));
    const result = await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID });
    expect(result).toEqual({ ok: false, message: "The price of your order has changed. Please check the new total." });
  });
});

describe("placeOrder — place_order errors", () => {
  it.each([
    ["kitchen_unavailable", "This kitchen isn't accepting orders right now."],
    ["item_unavailable", "One of the items in your cart is no longer available."],
    ["invalid_quantity", "Invalid item quantity in cart."],
    ["kitchen_location_missing", "This kitchen hasn't finished setting up its location yet."],
    ["something unexpected", "Couldn't place order: something unexpected"],
  ])("words %s for the customer", async (message, shown) => {
    useDb();
    useAdmin(() => ({ error: { code: "P0001", message } }));
    await expect(placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID })).resolves.toEqual({ ok: false, message: shown });
  });

  it("doesn't fall back to the old insert on an ordinary error", async () => {
    const db = useDb();
    useAdmin(() => ({ error: { code: "P0001", message: "item_unavailable" } }));
    await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID });
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });
});

describe("placeOrder — before place_order exists", () => {
  it("falls back to the old insert when PostgREST says the function is missing (PGRST202)", async () => {
    const db = useDb();
    const admin = useAdmin(() => ({ error: PLACE_ORDER_MISSING }));
    const result = await placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID });

    expect(admin.calls).toHaveLength(1);
    expect(result).toEqual({ ok: true, orderId: "order-old" });
    const orderInsert = db.ops.find((o) => o.table === "orders" && o.kind === "insert");
    // The old path prices from menu_items too: 2 x $2 + 1 x $3.
    expect(orderInsert?.values).toMatchObject({ customer_id: "customer-1", kitchen_id: "k1", subtotal: 7, delivery_fee_estimate: 3.3 });
    expect(db.ops.some((o) => o.table === "order_items" && o.kind === "insert")).toBe(true);
  });

  it("uses the old insert when the service-role key isn't configured", async () => {
    const db = useDb();
    vi.mocked(createAdminClient).mockReturnValue(null);
    await expect(placeOrder("k1", ITEMS, DELIVERY, { requestId: REQUEST_ID })).resolves.toEqual({ ok: true, orderId: "order-old" });
    expect(db.ops.some((o) => o.table === "orders" && o.kind === "insert")).toBe(true);
  });
});
