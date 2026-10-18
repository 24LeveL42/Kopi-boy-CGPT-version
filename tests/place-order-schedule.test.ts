import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { placeOrder } from "@/lib/order-actions";
import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";
import { createFakeDb, type DbOp, type DbResult } from "./helpers/fake-db-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

// The server's clock: 10:07 Singapore time.
const SERVER_NOW = new Date("2026-10-18T02:07:00.000Z");
const ITEMS = [{ menuItemId: "m1", quantity: 1 }];
const NEW_ADDRESS = { postalCode: "310123" };

function useDb(extra?: (op: DbOp) => DbResult | undefined) {
  const db = createFakeDb((op) => {
    const custom = extra?.(op);
    if (custom) return custom;
    if (op.table === "kitchens") return { data: { id: "k1", is_live: true, is_blocked: false } };
    if (op.table === "menu_items") return { data: [{ id: "m1", name: "Kopi", price: 2 }] };
    if (op.table === "orders") return { data: { id: "order-1" } };
    return {};
  });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  return db;
}

const orderInserts = (db: ReturnType<typeof useDb>) => db.ops.filter((o) => o.table === "orders" && o.kind === "insert");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SERVER_NOW);
  vi.mocked(createClient).mockReset();
  vi.mocked(geocodePostalCode)
    .mockReset()
    .mockResolvedValue({ ok: true, lat: 1.337, lng: 103.845, address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123" });
});
afterEach(() => vi.useRealTimers());

describe("placeOrder — When", () => {
  it("leaves scheduled_for out for As soon as possible, so it stays null", async () => {
    const db = useDb();
    await expect(placeOrder("k1", ITEMS, { deliveryType: "normal", scheduledFor: null, ...NEW_ADDRESS })).resolves.toEqual({ ok: true, orderId: "order-1" });
    expect(orderInserts(db)[0].values).not.toHaveProperty("scheduled_for");
    expect(orderInserts(db)[0].values).toMatchObject({ delivery_type: "normal" });
  });

  it("saves a valid slot to orders.scheduled_for, with the delivery type", async () => {
    const db = useDb();
    const result = await placeOrder("k1", ITEMS, { deliveryType: "express", scheduledFor: "2026-10-18T09:30:00.000Z", ...NEW_ADDRESS });
    expect(result).toEqual({ ok: true, orderId: "order-1" });
    expect(orderInserts(db)[0].values).toMatchObject({ scheduled_for: "2026-10-18T09:30:00.000Z", delivery_type: "express" });
  });

  it("refuses a slot that is too soon by the server's clock, before touching the database", async () => {
    const db = useDb();
    const result = await placeOrder("k1", ITEMS, { deliveryType: "normal", scheduledFor: "2026-10-18T02:30:00.000Z", ...NEW_ADDRESS });
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/45 minutes/) });
    expect(db.ops).toEqual([]);
  });

  it("refuses a slot more than 2 days out, or not on a :00/:30", async () => {
    useDb();
    expect(await placeOrder("k1", ITEMS, { deliveryType: "normal", scheduledFor: "2026-10-21T02:00:00.000Z", ...NEW_ADDRESS })).toMatchObject({ ok: false });
    expect(await placeOrder("k1", ITEMS, { deliveryType: "normal", scheduledFor: "2026-10-18T09:15:00.000Z", ...NEW_ADDRESS })).toMatchObject({ ok: false });
  });

  it("says scheduling isn't available, rather than placing an ASAP order, if the column is missing", async () => {
    const db = useDb((op) =>
      op.table === "orders" && op.kind === "insert" ? { error: { code: "PGRST204", message: "Could not find the 'scheduled_for' column" } } : undefined
    );
    const result = await placeOrder("k1", ITEMS, { deliveryType: "normal", scheduledFor: "2026-10-18T09:30:00.000Z", ...NEW_ADDRESS });
    expect(result).toEqual({ ok: false, message: "Scheduled delivery isn't available yet. Please choose As soon as possible." });
    expect(orderInserts(db).every((o) => o.values?.scheduled_for === "2026-10-18T09:30:00.000Z")).toBe(true);
  });

  it("reports addressSaved: false when Save this address fails, but the order is still placed", async () => {
    useDb((op) => {
      if (op.table === "customer_addresses" && op.head) return { count: 0 };
      if (op.table === "customer_addresses" && op.kind === "insert") return { error: { message: "nope" } };
      return undefined;
    });
    const result = await placeOrder("k1", ITEMS, { deliveryType: "normal", ...NEW_ADDRESS, saveAddress: true, saveLabel: "Home" });
    expect(result).toEqual({ ok: true, orderId: "order-1", addressSaved: false });
  });
});
