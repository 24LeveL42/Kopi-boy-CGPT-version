import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND_IMAGE_SLIDES, MAX_HERO_SLIDES, rotationSeed, seededShuffle, selectHeroSlides, slideImage } from "@/lib/hero-slides";
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
const BANNERS = ["brand-image", "brand-image", "brand-image", "brand-image", "brand-image"];
const live = (slides: { type: string }[]) => slides.filter((s) => s.type !== "brand-image");

describe("selectHeroSlides", () => {
  it("always starts with the brand slide, then the five banners when there's nothing live", () => {
    const slides = selectHeroSlides({ flashDeals: [], promotions: [], newKitchens: [], merchantsById: new Map(), seed: 1 });
    expect(slides.map((s) => s.type)).toEqual(["brand", ...BANNERS]);
  });

  it("shows up to 3 new kitchens", () => {
    const list = ["a", "b", "c", "d", "e"].map((id) => kitchen(id));
    const slides = selectHeroSlides({ flashDeals: [], promotions: [], newKitchens: list, merchantsById: byId(list), seed: 7 });
    expect(slides[0].type).toBe("brand");
    expect(slides.filter((s) => s.type === "new-kitchen")).toHaveLength(3);
  });

  it("never shows more than 6 live slides or two slides for one kitchen; the banners don't count", () => {
    const list = ["a", "b", "c", "d", "e", "f", "g"].map((id) => kitchen(id));
    const flash = [deal("f1", "a", "flash"), deal("f2", "a", "flash"), deal("f3", "b", "flash")];
    const promos = [deal("p1", "a"), deal("p2", "c"), deal("p3", "d"), deal("p4", "e")];
    const slides = selectHeroSlides({ flashDeals: flash, promotions: promos, newKitchens: list, merchantsById: byId(list), seed: 3 });
    expect(live(slides)).toHaveLength(MAX_HERO_SLIDES);
    expect(slides).toHaveLength(MAX_HERO_SLIDES + 5);
    const kitchens = slides.flatMap((s) => ("kitchen" in s ? [s.kitchen.id] : []));
    expect(new Set(kitchens).size).toBe(kitchens.length);
  });

  it("puts flash deals before promotions before new kitchens, and skips blocked kitchens", () => {
    const list = [kitchen("a"), kitchen("b"), kitchen("c"), kitchen("blocked", { isBlocked: true })];
    const slides = selectHeroSlides({ flashDeals: [deal("f", "a", "flash")], promotions: [deal("p", "b"), deal("pb", "blocked")], newKitchens: [kitchen("c")], merchantsById: byId(list), seed: 1 });
    expect(slides.map((s) => s.type)).toEqual(["brand", "flash", "promotion", "new-kitchen", ...BANNERS]);
  });

  it("ends with the five banners in a fixed order, the same for every seed", () => {
    const list = ["a", "b"].map((id) => kitchen(id));
    for (const seed of [1, 99, 123456]) {
      const slides = selectHeroSlides({ flashDeals: [], promotions: [], newKitchens: list, merchantsById: byId(list), seed });
      expect(slides.slice(-5).map((s) => ("src" in s ? s.src : null))).toEqual([
        "/brand-slides/cooking-nearby.png",
        "/brand-slides/real-people.png",
        "/brand-slides/made-simple.png",
        "/brand-slides/stronger-community.png",
        "/brand-slides/islandwide.png",
      ]);
    }
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

describe("BRAND_IMAGE_SLIDES", () => {
  it("only links cooking-nearby, gives every banner its wording as alt text, and every file exists", () => {
    expect(BRAND_IMAGE_SLIDES.filter((s) => s.linksToAllCooks).map((s) => s.key)).toEqual(["brand-image-cooking-nearby"]);
    for (const slide of BRAND_IMAGE_SLIDES) {
      expect(slide.alt.length).toBeGreaterThan(20);
      expect(slide.focus).toBe("left center"); // logo and headline are on the left of every banner
      expect(existsSync(join(process.cwd(), "public", slide.src))).toBe(true);
    }
  });

  it("never uses the rider recruitment banner anywhere in the code", () => {
    expect(BRAND_IMAGE_SLIDES.some((s) => s.src.includes("rider"))).toBe(false);
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
    const hits = files(join(process.cwd(), "src")).filter((f) => readFileSync(f, "utf8").includes("rider-recruitment"));
    expect(hits).toEqual([]);
  });
});

describe("slideImage", () => {
  it("prefers the cover photo, then the first menu photo, then the category picture", () => {
    expect(slideImage(kitchen("a", { coverImage: "/cover.jpg", menuPhoto: "/menu.jpg" }))).toBe("/cover.jpg");
    expect(slideImage(kitchen("a", { coverImage: null, menuPhoto: "/menu.jpg" }))).toBe("/menu.jpg");
    expect(slideImage(kitchen("a", { coverImage: null, menuPhoto: null }))).toBe("/categories/hawkers.jpg");
  });
});
