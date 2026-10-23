import { describe, it, expect } from "vitest";
import { MAX_HERO_SLIDES, rotationSeed, seededShuffle, selectHeroSlides, slideImage } from "@/lib/hero-slides";
import type { KitchenDeal } from "@/lib/deals";
import type { Merchant } from "@/lib/types";

function kitchen(id: string, overrides: Partial<Merchant> = {}): Merchant {
  return {
    id, name: id, category: "hawker", cuisine: "Chinese", area: null, blurb: "", rating: 0, ratingCount: 0, etaMinutes: 30, distanceKm: null,
    latitude: null, longitude: null, priceFrom: 5, heroImage: "/categories/hawkers.jpg", avatarImage: "/categories/hawkers.jpg", cuisineType: "chinese",
    menuHighlights: [], isNew: true, ...overrides,
  };
}

function deal(id: string, kitchenId: string, kind: KitchenDeal["kind"] = "percent_off"): KitchenDeal {
  return {
    id, kitchenId, kind, title: "Deal", percentOff: 10, amountOff: null, buyQty: null, getQty: null, itemName: null, minSpend: null,
    originalPrice: 8.5, dealPrice: 6.5, startsAt: null, endsAt: "2099-01-01T00:00:00Z", remainingQty: null,
  };
}

const byId = (list: Merchant[]) => new Map(list.map((m) => [m.id, m]));

describe("selectHeroSlides", () => {
  it("always starts with the brand slide, and adds the fallback when there's nothing else", () => {
    const slides = selectHeroSlides({ flashDeals: [], promotions: [], newKitchens: [], merchantsById: new Map(), seed: 1 });
    expect(slides.map((s) => s.type)).toEqual(["brand", "fallback"]);
  });

  it("shows up to 3 new kitchens and no fallback", () => {
    const list = ["a", "b", "c", "d", "e"].map((id) => kitchen(id));
    const slides = selectHeroSlides({ flashDeals: [], promotions: [], newKitchens: list, merchantsById: byId(list), seed: 7 });
    expect(slides[0].type).toBe("brand");
    expect(slides.filter((s) => s.type === "new-kitchen")).toHaveLength(3);
    expect(slides.some((s) => s.type === "fallback")).toBe(false);
  });

  it("never shows more than 6 slides or two slides for one kitchen", () => {
    const list = ["a", "b", "c", "d", "e", "f", "g"].map((id) => kitchen(id));
    const flash = [deal("f1", "a", "flash"), deal("f2", "a", "flash"), deal("f3", "b", "flash")];
    const promos = [deal("p1", "a"), deal("p2", "c"), deal("p3", "d"), deal("p4", "e")];
    const slides = selectHeroSlides({ flashDeals: flash, promotions: promos, newKitchens: list, merchantsById: byId(list), seed: 3 });
    expect(slides.length).toBeLessThanOrEqual(MAX_HERO_SLIDES);
    expect(slides).toHaveLength(6);
    const kitchens = slides.flatMap((s) => ("kitchen" in s ? [s.kitchen.id] : []));
    expect(new Set(kitchens).size).toBe(kitchens.length);
  });

  it("puts flash deals before promotions before new kitchens, and skips blocked kitchens", () => {
    const list = [kitchen("a"), kitchen("b"), kitchen("c"), kitchen("blocked", { isBlocked: true })];
    const slides = selectHeroSlides({ flashDeals: [deal("f", "a", "flash")], promotions: [deal("p", "b"), deal("pb", "blocked")], newKitchens: [kitchen("c")], merchantsById: byId(list), seed: 1 });
    expect(slides.map((s) => s.type)).toEqual(["brand", "flash", "promotion", "new-kitchen"]);
  });

  it("picks the same order for the same seed and a different one across hours", () => {
    const list = Array.from({ length: 12 }, (_, i) => `k${i}`);
    expect(seededShuffle(list, 42)).toEqual(seededShuffle(list, 42));
    expect(seededShuffle(list, 42)).not.toEqual(list);
    const hour = 3_600_000;
    expect(rotationSeed(5, 10 * hour)).not.toBe(rotationSeed(5, 11 * hour));
    expect(rotationSeed(5, 10 * hour)).toBe(rotationSeed(5, 10 * hour + 1000));
  });
});

describe("slideImage", () => {
  it("prefers the cover photo, then the first menu photo, then the category picture", () => {
    expect(slideImage(kitchen("a", { coverImage: "/cover.jpg", menuPhoto: "/menu.jpg" }))).toBe("/cover.jpg");
    expect(slideImage(kitchen("a", { coverImage: null, menuPhoto: "/menu.jpg" }))).toBe("/menu.jpg");
    expect(slideImage(kitchen("a", { coverImage: null, menuPhoto: null }))).toBe("/categories/hawkers.jpg");
  });
});
