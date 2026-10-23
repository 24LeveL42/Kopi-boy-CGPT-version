import { describe, it, expect, vi, beforeEach } from "vitest";
import { firstOrigin, kitchensWithin, resolveNearby } from "@/lib/home-location";
import { findNearbyKitchenIds } from "@/lib/home-actions";
import { geocodePostalCode } from "@/lib/geocode";

const db = vi.hoisted(() => ({
  user: null as { id: string } | null,
  address: null as { lat: number; lng: number } | null,
  addressError: null as { code: string; message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) builder[m] = () => builder;
      builder.maybeSingle = async () => ({ data: db.address, error: db.addressError });
      return builder;
    },
  }),
}));
vi.mock("@/lib/geocode", () => ({ geocodePostalCode: vi.fn() }));

// Toa Payoh-ish origin; "near" is ~1 km away, "far" ~20 km (Jurong), "nowhere" has no coordinates.
const HOME = { latitude: 1.3343, longitude: 103.8563 };
const KITCHENS = [
  { id: "near", latitude: 1.3404, longitude: 103.8501 },
  { id: "far", latitude: 1.3329, longitude: 103.7436 },
  { id: "nowhere", latitude: null, longitude: null },
];

describe("firstOrigin — location order", () => {
  it("stops at the first step that finds a location and never runs later steps", async () => {
    const later = vi.fn(() => HOME);
    const result = await firstOrigin([
      ["saved-address", async () => null],
      ["postal-code", async () => HOME],
      ["browser", later],
    ] as const);
    expect(result).toEqual({ source: "postal-code", origin: HOME });
    expect(later).not.toHaveBeenCalled();
  });

  it("is 'none' when nothing finds a location", async () => {
    expect(await firstOrigin([["saved-address", () => null]] as const)).toEqual({ source: "none", origin: null });
  });
});

describe("kitchensWithin", () => {
  it("keeps kitchens inside the radius and skips ones without coordinates", () => {
    expect(kitchensWithin(HOME, KITCHENS, 8)).toEqual(["near"]);
    expect(kitchensWithin(HOME, KITCHENS, 30)).toEqual(["near", "far"]);
  });
});

describe("resolveNearby — server answer, then browser location, then no filter", () => {
  it("uses the server's saved address / postal code answer first", () => {
    const r = resolveNearby({ source: "saved-address", nearbyIds: ["far"] }, HOME, KITCHENS, 8);
    expect(r.source).toBe("saved-address");
    expect([...r.nearbyIds!]).toEqual(["far"]);
  });

  it("falls back to the browser location the customer already shared", () => {
    const r = resolveNearby({ source: "none", nearbyIds: [] }, HOME, KITCHENS, 8);
    expect(r.source).toBe("browser");
    expect([...r.nearbyIds!]).toEqual(["near"]);
  });

  it("has no distance filter with no location at all", () => {
    expect(resolveNearby(null, null, KITCHENS, 8)).toEqual({ source: "none", nearbyIds: null });
  });
});

describe("findNearbyKitchenIds — server side of the order", () => {
  beforeEach(() => {
    db.user = { id: "u-1" };
    db.address = null;
    db.addressError = null;
    vi.mocked(geocodePostalCode).mockReset();
  });

  it("answers 'none' for signed-out customers without geocoding", async () => {
    db.user = null;
    expect(await findNearbyKitchenIds("310123", KITCHENS)).toEqual({ source: "none", nearbyIds: [] });
    expect(geocodePostalCode).not.toHaveBeenCalled();
  });

  it("uses the default saved address before the remembered postal code", async () => {
    db.address = { lat: HOME.latitude, lng: HOME.longitude };
    expect(await findNearbyKitchenIds("310123", KITCHENS)).toEqual({ source: "saved-address", nearbyIds: ["near"] });
    expect(geocodePostalCode).not.toHaveBeenCalled();
  });

  it("uses the remembered postal code when there's no saved address (or the table isn't there yet)", async () => {
    db.addressError = { code: "PGRST205", message: "missing table" };
    vi.mocked(geocodePostalCode).mockResolvedValue({ ok: true, lat: 1.3329, lng: 103.7436, address: "Jurong" });
    expect(await findNearbyKitchenIds("600111", KITCHENS)).toEqual({ source: "postal-code", nearbyIds: ["far"] });
  });

  it("answers 'none' with neither, so the browser decides", async () => {
    expect(await findNearbyKitchenIds("", KITCHENS)).toEqual({ source: "none", nearbyIds: [] });
    expect(geocodePostalCode).not.toHaveBeenCalled();
  });

  it("ignores junk kitchen entries", async () => {
    db.address = { lat: HOME.latitude, lng: HOME.longitude };
    const junk = [{ id: 5 }, null, { id: "x", latitude: "abc", longitude: 1 }, KITCHENS[0]] as never;
    expect(await findNearbyKitchenIds("", junk)).toEqual({ source: "saved-address", nearbyIds: ["near"] });
  });
});
