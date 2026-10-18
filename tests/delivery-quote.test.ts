import { describe, it, expect, vi, beforeEach } from "vitest";
import { quoteDelivery } from "@/lib/delivery-actions";
import { placeOrder } from "@/lib/order-actions";
import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

const FOUND = { ok: true as const, lat: 1.337, lng: 103.845, address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123" };

// Stand-in for the quote_delivery RPC: the real math lives in the database.
// Only distance and type go in, which is the point.
function fakeQuoteDelivery(args: { p_type: string }, distanceKm = 5) {
  const base = args.p_type === "express" ? 4 : 2.8;
  return { distance_km: distanceKm, delivery_fee: Math.round((base + Math.max(0, distanceKm - 2) * 0.5) * 100) / 100 };
}

interface MockOptions {
  user?: string | null;
  rpc?: (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };
  menu?: { id: string; name: string; price: number }[];
}

function makeSupabase({ user = "customer-1", rpc, menu = [] }: MockOptions = {}) {
  const inserts: { table: string; values: unknown }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  function from(table: string) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(async () => ({ data: menu, error: null })),
      maybeSingle: vi.fn(async () => ({ data: table === "kitchens" ? { id: "kitchen-1", is_live: true } : null })),
      insert: vi.fn((values: unknown) => {
        inserts.push({ table, values });
        return table === "order_items" ? Promise.resolve({ error: null }) : chain;
      }),
      single: vi.fn(async () => ({ data: { id: "order-1" }, error: null })),
    };
    return chain;
  }

  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: user ? { id: user } : null } })) },
    from: vi.fn(from),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpc ? rpc(args) : { data: [fakeQuoteDelivery(args as { p_type: string })], error: null };
    }),
    inserts,
    rpcCalls,
  };
}

function useSupabase(options?: MockOptions) {
  const supabase = makeSupabase(options);
  vi.mocked(createClient).mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(geocodePostalCode).mockReset();
  vi.mocked(geocodePostalCode).mockResolvedValue(FOUND);
});

describe("quoteDelivery (server action)", () => {
  it("geocodes the postal code and returns the RPC's distance and fee", async () => {
    const supabase = useSupabase();
    const result = await quoteDelivery("kitchen-1", "310123", "normal");

    expect(geocodePostalCode).toHaveBeenCalledWith("310123");
    expect(supabase.rpcCalls).toEqual([
      { name: "quote_delivery", args: { p_kitchen_id: "kitchen-1", p_lat: FOUND.lat, p_lng: FOUND.lng, p_type: "normal" } },
    ]);
    expect(result).toEqual({ ok: true, address: FOUND.address, distanceKm: 5, fee: 4.3 });
    // Coordinates stay on the server.
    expect(result).not.toHaveProperty("lat");
  });

  it("express costs more than normal for the same distance", async () => {
    useSupabase();
    const normal = await quoteDelivery("kitchen-1", "310123", "normal");
    const express = await quoteDelivery("kitchen-1", "310123", "express");
    expect(normal).toMatchObject({ ok: true, fee: 4.3, distanceKm: 5 });
    expect(express).toMatchObject({ ok: true, fee: 5.5, distanceKm: 5 });
  });

  it("rejects an unknown delivery type without geocoding", async () => {
    const supabase = useSupabase();
    expect(await quoteDelivery("kitchen-1", "310123", "rocket")).toEqual({ ok: false, reason: "error" });
    expect(geocodePostalCode).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("requires a signed-in customer and doesn't geocode for anyone else", async () => {
    useSupabase({ user: null });
    expect(await quoteDelivery("kitchen-1", "310123", "normal")).toEqual({ ok: false, reason: "signed_out" });
    expect(geocodePostalCode).not.toHaveBeenCalled();
  });

  it.each(["not_found", "unavailable", "invalid"] as const)("passes a geocode %s through without calling the RPC", async (reason) => {
    const supabase = useSupabase();
    vi.mocked(geocodePostalCode).mockResolvedValue({ ok: false, reason });
    expect(await quoteDelivery("kitchen-1", "310123", "normal")).toEqual({ ok: false, reason });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["kitchen_location_missing", "kitchen_location_missing"],
    ["invalid_location", "invalid_location"],
    ["invalid_delivery_type", "error"],
    ["something else", "error"],
  ])("maps the RPC error %s to %s", async (message, reason) => {
    useSupabase({ rpc: () => ({ data: null, error: { message } }) });
    expect(await quoteDelivery("kitchen-1", "310123", "normal")).toEqual({ ok: false, reason });
  });

  it("treats an empty RPC result as an error", async () => {
    useSupabase({ rpc: () => ({ data: [], error: null }) });
    expect(await quoteDelivery("kitchen-1", "310123", "normal")).toEqual({ ok: false, reason: "error" });
  });
});

describe("placeOrder — server-side delivery fee", () => {
  const MENU = [
    { id: "m1", name: "Kopi", price: 2 },
    { id: "m2", name: "Kaya Toast", price: 3 },
  ];

  function orderInsert(supabase: ReturnType<typeof makeSupabase>) {
    return supabase.inserts.find((i) => i.table === "orders")?.values as Record<string, unknown> | undefined;
  }

  it("stores postal code, geocoded coordinates, type, distance and the RPC's fee", async () => {
    const supabase = useSupabase({ menu: MENU });
    const result = await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 2 }], { postalCode: "310123", deliveryType: "express" });

    expect(result).toEqual({ ok: true, orderId: "order-1" });
    expect(orderInsert(supabase)).toEqual({
      customer_id: "customer-1",
      kitchen_id: "kitchen-1",
      subtotal: 4,
      customer_postal_code: "310123",
      customer_lat: FOUND.lat,
      customer_lng: FOUND.lng,
      delivery_type: "express",
      delivery_distance_km: 5,
      delivery_fee_estimate: 5.5,
      delivery_address_line: FOUND.address,
      delivery_unit: null,
      delivery_notes: null,
    });
  });

  it("ignores any fee or coordinates a client tries to send", async () => {
    const supabase = useSupabase({ menu: MENU });
    const tampered = { postalCode: "310123", deliveryType: "normal", fee: 0.01, delivery_fee_estimate: 0.01, latitude: 1.4, longitude: 103.9 };
    await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 1 }], tampered as never);

    expect(orderInsert(supabase)).toMatchObject({ delivery_fee_estimate: 4.3, customer_lat: FOUND.lat, customer_lng: FOUND.lng });
  });

  it("charges the same fee for 1 item as for 25 — only distance and type count", async () => {
    const small = useSupabase({ menu: MENU });
    await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 1 }], { postalCode: "310123", deliveryType: "normal" });
    const large = useSupabase({ menu: MENU });
    await placeOrder(
      "kitchen-1",
      [
        { menuItemId: "m1", quantity: 20 },
        { menuItemId: "m2", quantity: 5 },
      ],
      { postalCode: "310123", deliveryType: "normal" }
    );

    expect(orderInsert(small)?.subtotal).toBe(2);
    expect(orderInsert(large)?.subtotal).toBe(55);
    expect(orderInsert(small)?.delivery_fee_estimate).toBe(4.3);
    expect(orderInsert(large)?.delivery_fee_estimate).toBe(4.3);
    expect(large.rpcCalls[0].args).toEqual(small.rpcCalls[0].args);
  });

  it("creates no order when postal code lookup is unavailable", async () => {
    const supabase = useSupabase({ menu: MENU });
    vi.mocked(geocodePostalCode).mockResolvedValue({ ok: false, reason: "unavailable" });
    const result = await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 1 }], { postalCode: "310123", deliveryType: "normal" });

    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Postal code lookup is temporarily unavailable\./) });
    expect(supabase.inserts).toEqual([]);
  });

  it("creates no order when the kitchen has no location yet", async () => {
    const supabase = useSupabase({ menu: MENU, rpc: () => ({ data: null, error: { message: "kitchen_location_missing" } }) });
    const result = await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 1 }], { postalCode: "310123", deliveryType: "normal" });

    expect(result).toEqual({ ok: false, message: "This kitchen hasn't finished setting up its location yet." });
    expect(supabase.inserts).toEqual([]);
  });

  it("creates no order for an unknown postal code", async () => {
    const supabase = useSupabase({ menu: MENU });
    vi.mocked(geocodePostalCode).mockResolvedValue({ ok: false, reason: "not_found" });
    const result = await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 1 }], { postalCode: "999999", deliveryType: "normal" });

    expect(result).toEqual({ ok: false, message: "We couldn't find that postal code. Please check it." });
    expect(supabase.inserts).toEqual([]);
  });

  it("needs a 6-digit postal code and a valid type before doing anything", async () => {
    const supabase = useSupabase({ menu: MENU });
    expect(await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 1 }], { postalCode: "3101", deliveryType: "normal" })).toMatchObject({ ok: false });
    expect(
      await placeOrder("kitchen-1", [{ menuItemId: "m1", quantity: 1 }], { postalCode: "310123", deliveryType: "rocket" as never })
    ).toMatchObject({ ok: false });
    expect(geocodePostalCode).not.toHaveBeenCalled();
    expect(supabase.inserts).toEqual([]);
  });
});
