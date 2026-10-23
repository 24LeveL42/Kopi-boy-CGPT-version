import { describe, it, expect, vi, beforeEach } from "vitest";
import { placeOrder } from "@/lib/order-actions";
import { createClient } from "@/lib/supabase/server";
import { quoteDeliveryForPostalCode } from "@/lib/delivery-quote";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFakeAdmin, PLACE_ORDER_MISSING } from "./helpers/fake-admin";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/delivery-quote", () => ({ quoteDeliveryForPostalCode: vi.fn() }));

type Result = { data: unknown; error: { code?: string; message: string } | null };

/**
 * kitchens lookups answer from `kitchenResults` in order (the first asks for
 * is_blocked; a second only happens on the 42703 fallback). Records every
 * table touched and every insert.
 */
function makeSupabase(kitchenResults: Result[]) {
  const tables: string[] = [];
  const inserts: [string, unknown][] = [];
  const kitchenSelects: string[] = [];
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "customer-1" } } })) },
    from: vi.fn((table: string) => {
      tables.push(table);
      const builder: Record<string, unknown> = {};
      builder.select = (cols: string) => {
        if (table === "kitchens") kitchenSelects.push(cols);
        return builder;
      };
      builder.eq = () => builder;
      builder.in = async () => ({ data: [{ id: "m1", name: "Kopi", price: 2 }], error: null });
      builder.maybeSingle = async () => kitchenResults.shift() ?? { data: null, error: null };
      builder.insert = (values: unknown) => {
        inserts.push([table, values]);
        return { select: () => ({ single: async () => ({ data: { id: "order-1" }, error: null }) }), then: (r: (v: unknown) => void) => r({ error: null }) };
      };
      return builder;
    }),
  };
  return { client, tables, inserts, kitchenSelects };
}

const ITEMS = [{ menuItemId: "m1", quantity: 1 }];
const DELIVERY = { postalCode: "310123", deliveryType: "normal" as const };

let admin: ReturnType<typeof createFakeAdmin>;

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  admin = createFakeAdmin();
  vi.mocked(createAdminClient).mockReset().mockReturnValue(admin.client as never);
  vi.mocked(quoteDeliveryForPostalCode).mockReset().mockResolvedValue({ ok: true, address: "x", lat: 1.3, lng: 103.8, distanceKm: 3, fee: 3.3 });
});

describe("placeOrder — blocked kitchen", () => {
  it("refuses with a clean result (no throw) and creates nothing", async () => {
    const sb = makeSupabase([{ data: { id: "k1", is_live: true, is_blocked: true }, error: null }]);
    vi.mocked(createClient).mockResolvedValue(sb.client as never);

    await expect(placeOrder("k1", ITEMS, DELIVERY)).resolves.toEqual({ ok: false, message: "This kitchen is currently unavailable." });

    expect(sb.kitchenSelects[0]).toContain("is_blocked"); // read from the database, not the browser
    expect(sb.inserts).toEqual([]);
    expect(sb.tables).not.toContain("orders");
    expect(quoteDeliveryForPostalCode).not.toHaveBeenCalled();
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });

  it("still places orders at an available kitchen, through place_order", async () => {
    const sb = makeSupabase([{ data: { id: "k1", is_live: true, is_blocked: false }, error: null }]);
    vi.mocked(createClient).mockResolvedValue(sb.client as never);

    await expect(placeOrder("k1", ITEMS, DELIVERY)).resolves.toEqual({ ok: true, orderId: "order-1" });
    expect(admin.calls.map((c) => c.name)).toEqual(["place_order"]);
    expect(sb.inserts).toEqual([]);
  });

  it("refuses cleanly when place_order finds the kitchen blocked after the app's own check", async () => {
    const sb = makeSupabase([{ data: { id: "k1", is_live: true, is_blocked: false }, error: null }]);
    vi.mocked(createClient).mockResolvedValue(sb.client as never);
    admin = createFakeAdmin(() => ({ error: { code: "P0001", message: "kitchen_blocked" } }));
    vi.mocked(createAdminClient).mockReturnValue(admin.client as never);

    await expect(placeOrder("k1", ITEMS, DELIVERY)).resolves.toEqual({ ok: false, message: "This kitchen is currently unavailable." });
  });

  it("old insert path: inserts the order and its items", async () => {
    const sb = makeSupabase([{ data: { id: "k1", is_live: true, is_blocked: false }, error: null }]);
    vi.mocked(createClient).mockResolvedValue(sb.client as never);
    admin = createFakeAdmin(() => ({ error: PLACE_ORDER_MISSING }));
    vi.mocked(createAdminClient).mockReturnValue(admin.client as never);

    await expect(placeOrder("k1", ITEMS, DELIVERY)).resolves.toEqual({ ok: true, orderId: "order-1" });
    expect(sb.inserts.map(([t]) => t)).toEqual(["orders", "order_items"]);
  });

  it("keeps working before the is_blocked column exists (42703 fallback)", async () => {
    const sb = makeSupabase([
      { data: null, error: { code: "42703", message: "column kitchens.is_blocked does not exist" } },
      { data: { id: "k1", is_live: true }, error: null },
    ]);
    vi.mocked(createClient).mockResolvedValue(sb.client as never);

    await expect(placeOrder("k1", ITEMS, DELIVERY)).resolves.toEqual({ ok: true, orderId: "order-1" });
    expect(sb.kitchenSelects[1]).not.toContain("is_blocked");
  });
});
