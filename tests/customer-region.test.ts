import { describe, it, expect, vi, beforeEach } from "vitest";
import { findCustomerRegion } from "@/lib/home-actions";
import { geocodePostalCode } from "@/lib/geocode";

type Result = { data: unknown; error: { code: string; message: string } | null };

const db = vi.hoisted(() => ({
  user: null as { id: string } | null,
  address: { data: null, error: null } as Result,
  sector: { data: null, error: null } as Result,
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => (db.calls.push(`${table}: select ${columns}`), builder);
      builder.eq = (column: string, value: unknown) => (db.calls.push(`${table}: ${column}=${value}`), builder);
      builder.maybeSingle = async () => (table === "postal_sector_regions" ? db.sector : db.address);
      return builder;
    },
  }),
}));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

const ok = (data: unknown): Result => ({ data, error: null });

describe("findCustomerRegion — the customer's region from a postal code the app already has", () => {
  beforeEach(() => {
    db.user = null;
    db.address = ok(null);
    db.sector = ok(null);
    db.calls = [];
    vi.mocked(geocodePostalCode).mockReset();
  });

  it("looks up the remembered postal code's sector (first 2 digits) in postal_sector_regions", async () => {
    db.sector = ok({ region: "east" });
    expect(await findCustomerRegion("460123")).toBe("east");
    expect(db.calls).toEqual(["postal_sector_regions: select region", "postal_sector_regions: sector=46"]);
  });

  it("prefers the signed-in customer's default saved address", async () => {
    db.user = { id: "u-1" };
    db.address = ok({ postal_code: "090123" });
    db.sector = ok({ region: "south" });
    expect(await findCustomerRegion("460123")).toBe("south");
    expect(db.calls).toContain("customer_addresses: select postal_code");
    expect(db.calls).toContain("postal_sector_regions: sector=09");
  });

  it("falls back to the remembered postal code when there's no saved address (or it errors)", async () => {
    db.user = { id: "u-1" };
    db.address = { data: null, error: { code: "PGRST205", message: "missing table" } };
    db.sector = ok({ region: "west" });
    expect(await findCustomerRegion("600111")).toBe("west");
    expect(db.calls).toContain("postal_sector_regions: sector=60");
  });

  it("is null with no postal code at all: no region ordering, and no lookup", async () => {
    for (const code of ["", "123", "abcdef", "1234567"]) expect(await findCustomerRegion(code)).toBeNull();
    expect(db.calls.filter((c) => c.startsWith("postal_sector_regions"))).toEqual([]);
  });

  it("is null for an unmapped sector, a bad value, or an error", async () => {
    db.sector = ok(null);
    expect(await findCustomerRegion("740123")).toBeNull();
    db.sector = ok({ region: "central" });
    expect(await findCustomerRegion("310123")).toBeNull();
    db.sector = { data: null, error: { code: "42501", message: "denied" } };
    expect(await findCustomerRegion("310123")).toBeNull();
  });

  it("never geocodes: a region is a table lookup only", async () => {
    db.sector = ok({ region: "north" });
    await findCustomerRegion("560123");
    expect(geocodePostalCode).not.toHaveBeenCalled();
  });
});
