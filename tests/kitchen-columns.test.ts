import { describe, it, expect } from "vitest";
import { formatKitchenArea, loadKitchenLocations, loadOrderPaynow, roundCoordinate, selectKitchens } from "@/lib/kitchens";

const missing = (col: string) => ({ data: null, error: { code: "42703", message: `column kitchens.${col} does not exist`, details: "", hint: "", name: "PostgrestError" } });

describe("selectKitchens — customer-readable kitchen columns", () => {
  it("never asks for business_address, neighbourhood or *", async () => {
    const asked: string[] = [];
    await selectKitchens(async (columns) => (asked.push(columns), { data: [], error: null }));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("postal_sector");
    expect(asked[0]).not.toMatch(/business_address|neighbourhood|postal_code|\*/);
  });

  it("never asks for the columns hidden from the public (docs/supabase-kitchen-privacy.sql)", async () => {
    const asked: string[] = [];
    await selectKitchens(async (columns) => (asked.push(columns), { data: [], error: null }));
    expect(asked[0]).not.toMatch(/paynow|latitude|longitude|acknowledged_terms_at/);
  });

  it("drops only the optional column that doesn't exist yet, and retries", async () => {
    const asked: string[] = [];
    const result = await selectKitchens(async (columns) => {
      asked.push(columns);
      return columns.includes("business_uen") ? missing("business_uen") : { data: [{ id: "k-1" }], error: null };
    });
    expect(result.data).toEqual([{ id: "k-1" }]);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain("postal_sector");
  });

  it("passes any other error straight through", async () => {
    const denied = { data: null, error: { code: "42501", message: "permission denied for table kitchens", details: "", hint: "", name: "PostgrestError" } };
    let calls = 0;
    const result = await selectKitchens(async () => (calls++, denied));
    expect(result).toBe(denied);
    expect(calls).toBe(1);
  });
});

describe("formatKitchenArea — postal sector only", () => {
  it("shows only the first two digits of a full postal code", () => {
    expect(formatKitchenArea("310123")).toBe("Postal sector 31");
    expect(formatKitchenArea(" 560456 ")).toBe("Postal sector 56");
  });

  it("works when the Partner app already exposes only the sector", () => {
    expect(formatKitchenArea("31")).toBe("Postal sector 31");
  });

  it("is null for a missing or unusable value", () => {
    for (const v of [null, undefined, "", "   ", "3", "abc123"]) expect(formatKitchenArea(v)).toBeNull();
  });
});

/** A tiny stand-in for the server Supabase client: per-table (or per-rpc) results, and a log of what was asked. */
function fakeSupabase(results: Record<string, { data: unknown; error: { code?: string; message: string } | null }>) {
  const log: string[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => (log.push(`rpc ${fn} ${JSON.stringify(args)}`), results[`rpc:${fn}`]),
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => (log.push(`${table}: ${columns}`), builder);
      for (const m of ["eq", "in"]) builder[m] = () => builder;
      builder.returns = () => Promise.resolve(results[table]);
      builder.maybeSingle = () => Promise.resolve(results[table]);
      return builder;
    },
  };
  return { client: client as never, log };
}

const ok = (data: unknown) => ({ data, error: null });
const fail = (code: string) => ({ data: null, error: { code, message: code } });

describe("loadKitchenLocations — rounded coordinates only", () => {
  it("rounds to 2 decimals, and drops unusable values", () => {
    expect(roundCoordinate(1.345678)).toBe(1.35);
    expect(roundCoordinate("103.876543")).toBe(103.88);
    for (const v of [null, undefined, "", "abc"]) expect(roundCoordinate(v)).toBeNull();
  });

  it("reads the kitchen_public_locations view when it exists", async () => {
    const { client, log } = fakeSupabase({ kitchen_public_locations: ok([{ kitchen_id: "k1", latitude: "1.35", longitude: "103.88" }]) });
    const map = await loadKitchenLocations(client, ["k1"]);
    expect(map.get("k1")).toEqual({ latitude: 1.35, longitude: 103.88 });
    expect(log).toEqual(["kitchen_public_locations: kitchen_id, latitude, longitude"]);
  });

  it("before the SQL runs, falls back to the kitchen row and still rounds", async () => {
    const { client, log } = fakeSupabase({
      kitchen_public_locations: fail("PGRST205"),
      kitchens: ok([{ id: "k1", latitude: 1.345678, longitude: 103.876543 }, { id: "k2", latitude: null, longitude: null }]),
    });
    const map = await loadKitchenLocations(client, ["k1", "k2"]);
    expect([...map]).toEqual([["k1", { latitude: 1.35, longitude: 103.88 }]]);
    expect(log[1]).toBe("kitchens: id, latitude, longitude");
  });

  it("gives no coordinates (never an error) when neither can be read", async () => {
    const { client } = fakeSupabase({ kitchen_public_locations: fail("42501"), kitchens: fail("42501") });
    expect((await loadKitchenLocations(client, ["k1"])).size).toBe(0);
  });
});

describe("loadOrderPaynow — only via get_order_paynow once it exists", () => {
  const PAYNOW = { paynow_type: "mobile", paynow_value: "91234567" };

  it("uses the function's row", async () => {
    const { client, log } = fakeSupabase({ "rpc:get_order_paynow": ok([PAYNOW]) });
    expect(await loadOrderPaynow(client, "o1", "k1")).toEqual(PAYNOW);
    expect(log).toEqual(['rpc get_order_paynow {"p_order_id":"o1"}']);
  });

  it("is null when the function returns no row (not this customer's accepted order)", async () => {
    const { client, log } = fakeSupabase({ "rpc:get_order_paynow": ok([]) });
    expect(await loadOrderPaynow(client, "o1", "k1")).toBeNull();
    expect(log).toHaveLength(1);
  });

  it("falls back to the kitchen row only while the function doesn't exist yet", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const { client, log } = fakeSupabase({ "rpc:get_order_paynow": fail(code), kitchens: ok(PAYNOW) });
      expect(await loadOrderPaynow(client, "o1", "k1")).toEqual(PAYNOW);
      expect(log[1]).toBe("kitchens: paynow_type, paynow_value");
    }
  });

  it("is null on any other error, without touching the kitchen row", async () => {
    const { client, log } = fakeSupabase({ "rpc:get_order_paynow": fail("42501") });
    expect(await loadOrderPaynow(client, "o1", "k1")).toBeNull();
    expect(log).toHaveLength(1);
  });
});
