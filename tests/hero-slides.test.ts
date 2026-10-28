import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  BRAND_IMAGE_SLIDES,
  HERO_IMAGES,
  MAX_HERO_SLIDES,
  isHeroImageShowing,
  nextHeroImage,
  rotationSeed,
  seededShuffle,
  selectHeroSlides,
  showingHeroImages,
  singaporeDate,
  slideImage,
} from "@/lib/hero-slides";
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

  it("is no longer drawn by the carousel (the old banners stay in public/brand-slides, unused)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
    const users = files(join(process.cwd(), "src")).filter((f) => /BRAND_IMAGE_SLIDES|brand-slides\//.test(readFileSync(f, "utf8")));
    expect(users.map((f) => relative(process.cwd(), f).split(sep).join("/"))).toEqual(["src/lib/hero-slides.ts"]);
  });
});

/** Midnight at the start of a Singapore day, as a UTC timestamp (Singapore is UTC+8 all year). */
const sgMidnight = (day: string) => Date.parse(`${day}T00:00:00+08:00`);
const keys = (list: { key: string }[]) => list.map((i) => i.key);
const ALWAYS = ["01-browse", "02-real-people", "03-riders", "04-simple", "05-community", "06-islandwide"];

describe("HERO_IMAGES — the carousel's images", () => {
  it("plays the ten images in the agreed order, every file a real WebP in public/hero", () => {
    expect(keys([...HERO_IMAGES])).toEqual([...ALWAYS, "07-deepavali", "08-cny", "09-hari-raya", "10-christmas"]);
    for (const image of HERO_IMAGES) {
      expect(image.src).toBe(`/hero/${image.key}.webp`);
      const bytes = readFileSync(join(process.cwd(), "public", image.src));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    }
  });

  it("includes the rider banner (03-riders) as the third slide, always showing", () => {
    const riders = HERO_IMAGES[2];
    expect(riders.key).toBe("03-riders");
    expect(riders.window).toBeUndefined();
    expect(riders.linksToAllCooks).toBe(false); // no rider sign-up link exists in this app
    expect(riders.alt).toMatch(/Delivering goodness together/);
  });

  it("gives every image its wording as alt text", () => {
    for (const image of HERO_IMAGES) expect(image.alt.length, image.key).toBeGreaterThan(40);
    expect(HERO_IMAGES[0].alt).toMatch(/Something good is cooking nearby/);
    expect(HERO_IMAGES[7].alt).toMatch(/Chinese New Year 2027/);
  });

  it("links cooking-nearby and the four festive images, nothing else", () => {
    expect(keys(HERO_IMAGES.filter((i) => i.linksToAllCooks))).toEqual(["01-browse", "07-deepavali", "08-cny", "09-hari-raya", "10-christmas"]);
  });

  it("zooms every image at least 3% to hide the screenshot edges, 05 the most", () => {
    for (const image of HERO_IMAGES) {
      expect(image.zoom, image.key).toBeGreaterThanOrEqual(1.03);
      expect(image.zoomOrigin).toMatch(/^\d+% \d+%$/);
    }
    expect(Math.max(...HERO_IMAGES.map((i) => i.zoom))).toBe(HERO_IMAGES[4].zoom);
  });

  it("gives the festive images their Singapore date windows; 01-06 have none", () => {
    expect(Object.fromEntries(HERO_IMAGES.filter((i) => i.window).map((i) => [i.key, i.window]))).toEqual({
      "07-deepavali": { from: "2026-10-28", to: "2026-11-09" },
      "08-cny": { from: "2027-01-15", to: "2027-02-17" },
      "09-hari-raya": { from: "2027-02-20", to: "2027-03-20" },
      "10-christmas": { from: "2026-12-01", to: "2026-12-26" },
    });
  });
});

describe("seasonal windows — Singapore time, both days included", () => {
  it("reads the date in Singapore, not UTC", () => {
    expect(singaporeDate(Date.parse("2026-10-27T15:59:59Z"))).toBe("2026-10-27");
    expect(singaporeDate(Date.parse("2026-10-27T16:00:00Z"))).toBe("2026-10-28");
  });

  const edges: [string, string, string][] = [
    ["07-deepavali", "2026-10-28", "2026-11-09"],
    ["08-cny", "2027-01-15", "2027-02-17"],
    ["09-hari-raya", "2027-02-20", "2027-03-20"],
    ["10-christmas", "2026-12-01", "2026-12-26"],
  ];
  for (const [key, from, to] of edges) {
    it(`${key}: from 00:00 on ${from} to 23:59:59 on ${to}, Singapore time`, () => {
      const image = HERO_IMAGES.find((i) => i.key === key)!;
      const start = sgMidnight(from);
      const end = sgMidnight(to) + 86_400_000; // midnight after the last day
      expect(isHeroImageShowing(image, start - 1)).toBe(false);
      expect(isHeroImageShowing(image, start)).toBe(true);
      expect(isHeroImageShowing(image, end - 1)).toBe(true);
      expect(isHeroImageShowing(image, end)).toBe(false);
    });
  }

  it("shows only 01-06 outside every window, and adds just the one in season", () => {
    expect(keys(showingHeroImages(sgMidnight("2026-11-20")))).toEqual(ALWAYS);
    expect(keys(showingHeroImages(sgMidnight("2026-12-25")))).toEqual([...ALWAYS, "10-christmas"]);
    expect(keys(showingHeroImages(sgMidnight("2027-02-18")))).toEqual(ALWAYS); // between CNY and Hari Raya
  });
});

describe("nextHeroImage — forward only", () => {
  const inDeepavali = sgMidnight("2026-11-01");
  const offSeason = sgMidnight("2026-11-20");

  it("steps forward one image at a time and wraps from the last to the first", () => {
    let key = "01-browse";
    const seen = [key];
    for (let i = 0; i < 7; i++) seen.push((key = nextHeroImage(key, inDeepavali).key));
    expect(seen).toEqual([...ALWAYS, "07-deepavali", "01-browse"]);
  });

  it("skips a seasonal image outside its window, straight from 06 back to 01", () => {
    expect(nextHeroImage("06-islandwide", offSeason).key).toBe("01-browse");
    expect(nextHeroImage("06-islandwide", sgMidnight("2027-03-01")).key).toBe("09-hari-raya");
    expect(nextHeroImage("09-hari-raya", sgMidnight("2027-03-01")).key).toBe("01-browse"); // never backwards
  });

  it("moves on from a slide whose window has just closed", () => {
    expect(nextHeroImage("07-deepavali", offSeason).key).toBe("01-browse");
  });
});

describe("slideImage", () => {
  it("prefers the cover photo, then the first menu photo, then the category picture", () => {
    expect(slideImage(kitchen("a", { coverImage: "/cover.jpg", menuPhoto: "/menu.jpg" }))).toBe("/cover.jpg");
    expect(slideImage(kitchen("a", { coverImage: null, menuPhoto: "/menu.jpg" }))).toBe("/menu.jpg");
    expect(slideImage(kitchen("a", { coverImage: null, menuPhoto: null }))).toBe("/categories/hawkers.jpg");
  });
});
