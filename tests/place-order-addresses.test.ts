import { describe, it, expect, vi, beforeEach } from "vitest";
import { placeOrder } from "@/lib/order-actions";
import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";
import { createFakeDb, type DbOp, type DbResult } from "./helpers/fake-db-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

const ADDRESS_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const SAVED = { postal_code: "560123", address_line: "123 ANG MO KIO AVE 3 SINGAPORE 560123", unit: "#05-12", notes: "Call when you arrive" };
const GEO_SAVED = { ok: true as const, lat: 1.369, lng: 103.849, address: "123 ANG MO KIO AVE 3 SINGAPORE 560123" };
const GEO_NEW = { ok: true as const, lat: 1.337, lng: 103.845, address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123" };
const ITEMS = [{ menuItemId: "m1", quantity: 1 }];

/** Answers like the real tables. `owned` = whether the saved address belongs to customer-1. */
function useDb({ owned = true, addressCount = 1, extra }: { owned?: boolean; addressCount?: number; extra?: (op: DbOp) => DbResult | undefined } = {}) {
  const db = createFakeDb((op) => {
    const custom = extra?.(op);
    if (custom) return custom;
    if (op.table === "kitchens") return { data: { id: "k1", is_live: true, is_blocked: false } };
    if (op.table === "customer_addresses" && op.head) return { count: addressCount };
    if (op.table === "customer_addresses" && op.kind === "select") {
      // RLS + the user_id filter: someone else's id finds nothing.
      return { data: owned && op.filters.user_id === "customer-1" ? SAVED : null };
    }
    if (op.table === "menu_items") return { data: [{ id: "m1", name: "Kopi", price: 2 }] };
    if (op.table === "orders") return { data: { id: "order-1" } };
    return {};
  });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  return db;
}

const orderInsert = (db: ReturnType<typeof useDb>) => db.ops.find((o) => o.table === "orders" && o.kind === "insert")?.values;

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(geocodePostalCode)
    .mockReset()
    .mockImplementation(async (code) => (code === SAVED.postal_code ? GEO_SAVED : GEO_NEW));
});

describe("placeOrder — saved address", () => {
  it("reads the saved address for this customer, re-geocodes its postal code and snapshots it onto the order", async () => {
    const db = useDb();
    await expect(placeOrder("k1", ITEMS, { deliveryType: "normal", addressId: ADDRESS_ID })).resolves.toEqual({ ok: true, orderId: "order-1" });

    const lookup = db.ops.find((o) => o.table === "customer_addresses" && o.kind === "select");
    expect(lookup?.filters).toEqual({ id: ADDRESS_ID, user_id: "customer-1" });
    expect(geocodePostalCode).toHaveBeenCalledWith("560123");
    expect(orderInsert(db)).toMatchObject({
      customer_postal_code: "560123",
      customer_lat: GEO_SAVED.lat,
      customer_lng: GEO_SAVED.lng,
      delivery_distance_km: 3.04,
      delivery_fee_estimate: 3.3,
      delivery_address_line: SAVED.address_line,
      delivery_unit: "#05-12",
      delivery_notes: "Call when you arrive",
    });
  });

  it("refuses someone else's address id and creates nothing", async () => {
    const db = useDb({ owned: false });
    await expect(placeOrder("k1", ITEMS, { deliveryType: "normal", addressId: ADDRESS_ID })).resolves.toEqual({
      ok: false,
      message: "That saved address couldn't be found. Please choose another one.",
    });
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
    expect(geocodePostalCode).not.toHaveBeenCalled();
  });

  it("rejects a malformed address id without any query", async () => {
    const db = useDb();
    await expect(placeOrder("k1", ITEMS, { deliveryType: "normal", addressId: "1; drop table" })).resolves.toMatchObject({ ok: false });
    expect(db.ops).toEqual([]);
  });

  it("ignores coordinates, fee and address text sent by the browser", async () => {
    const db = useDb();
    const tampered = {
      deliveryType: "normal",
      addressId: ADDRESS_ID,
      postalCode: "018956",
      lat: 1.2,
      lng: 103.6,
      fee: 0.01,
      distanceKm: 0.1,
      delivery_address_line: "Somewhere else",
    };
    await placeOrder("k1", ITEMS, tampered as never);

    expect(geocodePostalCode).toHaveBeenCalledTimes(1);
    expect(geocodePostalCode).toHaveBeenCalledWith("560123");
    expect(orderInsert(db)).toMatchObject({
      customer_postal_code: "560123",
      customer_lat: GEO_SAVED.lat,
      customer_lng: GEO_SAVED.lng,
      delivery_fee_estimate: 3.3,
      delivery_distance_km: 3.04,
      delivery_address_line: SAVED.address_line,
    });
  });
});

describe("placeOrder — a different address", () => {
  it("geocodes the new postal code and snapshots the found address, unit and notes", async () => {
    const db = useDb();
    await placeOrder("k1", ITEMS, { deliveryType: "express", postalCode: "310123", unit: " #02-01 ", notes: "Leave at door" });

    expect(orderInsert(db)).toMatchObject({
      customer_postal_code: "310123",
      customer_lat: GEO_NEW.lat,
      delivery_address_line: GEO_NEW.address,
      delivery_unit: "#02-01",
      delivery_notes: "Leave at door",
      delivery_type: "express",
    });
    expect(db.ops.some((o) => o.table === "customer_addresses")).toBe(false);
  });

  it("saves it to the address book when asked, with server coordinates", async () => {
    const db = useDb({ addressCount: 0 });
    await expect(
      placeOrder("k1", ITEMS, { deliveryType: "normal", postalCode: "310123", unit: "#02-01", saveAddress: true, saveLabel: "Work" })
    ).resolves.toEqual({ ok: true, orderId: "order-1", addressSaved: true });

    const saved = db.ops.find((o) => o.table === "customer_addresses" && o.kind === "insert");
    expect(saved?.values).toEqual({
      user_id: "customer-1",
      label: "Work",
      postal_code: "310123",
      address_line: GEO_NEW.address,
      unit: "#02-01",
      notes: null,
      lat: GEO_NEW.lat,
      lng: GEO_NEW.lng,
      is_default: true,
    });
  });

  it("still places the order but doesn't save when the address book is full", async () => {
    const db = useDb({ addressCount: 5 });
    await expect(placeOrder("k1", ITEMS, { deliveryType: "normal", postalCode: "310123", saveAddress: true })).resolves.toEqual({
      ok: true,
      orderId: "order-1",
      addressSaved: false,
    });
    expect(db.ops.some((o) => o.table === "customer_addresses" && o.kind === "insert")).toBe(false);
  });

  it("rejects notes over 200 characters", async () => {
    useDb();
    await expect(placeOrder("k1", ITEMS, { deliveryType: "normal", postalCode: "310123", notes: "x".repeat(201) })).resolves.toEqual({
      ok: false,
      message: "Keep delivery notes to 200 characters.",
    });
  });

  it("falls back to the old insert if the address columns don't exist yet", async () => {
    let first = true;
    const db = useDb({
      extra: (op) => {
        if (op.table === "orders" && first) {
          first = false;
          return { error: { code: "PGRST204", message: "Could not find the 'delivery_address_line' column of 'orders'" } };
        }
      },
    });
    await expect(placeOrder("k1", ITEMS, { deliveryType: "normal", postalCode: "310123" })).resolves.toEqual({ ok: true, orderId: "order-1" });

    const inserts = db.ops.filter((o) => o.table === "orders");
    expect(inserts).toHaveLength(2);
    expect(inserts[1].values).not.toHaveProperty("delivery_address_line");
    expect(inserts[1].values).toMatchObject({ customer_postal_code: "310123", delivery_fee_estimate: 3.3 });
  });
});
