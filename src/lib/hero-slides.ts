import type { Merchant } from "@/lib/types";
import type { KitchenDeal } from "@/lib/deals";

/**
 * Which slides the home hero carousel shows — display only. Slide A is
 * always the brand hero. After it come flash deals, kitchen promotions and
 * new kitchens, each built from live data and at most one slide per
 * kitchen. The brand banners always close the loop, outside that limit.
 */
export const MAX_HERO_SLIDES = 6;
export const MAX_FLASH_SLIDES = 2;
export const MAX_PROMO_SLIDES = 2;
export const MAX_NEW_KITCHEN_SLIDES = 3;

export type HeroSlide =
  | { type: "brand"; key: "brand" }
  | { type: "flash"; key: string; kitchen: Merchant; deal: KitchenDeal; image: string }
  | { type: "promotion"; key: string; kitchen: Merchant; deal: KitchenDeal; image: string }
  | { type: "new-kitchen"; key: string; kitchen: Merchant; image: string }
  | { type: "brand-image"; key: string; src: string; alt: string; focus: string; linksToAllCooks: boolean };

export const BRAND_ONLY: HeroSlide[] = [{ type: "brand", key: "brand" }];

type BrandImageSlide = Extract<HeroSlide, { type: "brand-image" }>;

/**
 * The designed banners in public/brand-slides/, in the order they play. The
 * logo and headline are baked into each picture, so the alt text repeats
 * the wording. Each fills the hero box and is trimmed to fit; `focus` is the
 * CSS object-position kept in view — the logo and headline sit on the left
 * of every banner. Only cooking-nearby has a button drawn on it, so only it is a
 * link. The rider recruitment banner in the same folder is deliberately not used.
 */
export const BRAND_IMAGE_SLIDES: readonly BrandImageSlide[] = [
  { type: "brand-image", key: "brand-image-cooking-nearby", src: "/brand-slides/cooking-nearby.png", alt: "Something good is cooking nearby. Order straight from the people who make it.", focus: "left center", linksToAllCooks: true },
  { type: "brand-image", key: "brand-image-real-people", src: "/brand-slides/real-people.png", alt: "Real people. Real food. Support home cooks, hawkers, bakeries and small businesses in your area.", focus: "left center", linksToAllCooks: false },
  { type: "brand-image", key: "brand-image-made-simple", src: "/brand-slides/made-simple.png", alt: "Your favourite food, made simple. Discover, order, track, enjoy.", focus: "left center", linksToAllCooks: false },
  { type: "brand-image", key: "brand-image-stronger-community", src: "/brand-slides/stronger-community.png", alt: "Good food, stronger community. Support local cooks, empower riders, and keep our neighbourhoods thriving.", focus: "left center", linksToAllCooks: false },
  { type: "brand-image", key: "brand-image-islandwide", src: "/brand-slides/islandwide.png", alt: "Good food islandwide. From your neighbourhood to your doorstep.", focus: "left center", linksToAllCooks: false },
];

/** Cover photo, else the first menu photo, else the category picture. */
export function slideImage(kitchen: Merchant): string {
  return kitchen.coverImage || kitchen.menuPhoto || kitchen.heroImage;
}

/** Deterministic shuffle (mulberry32) so a seed always gives the same order. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const OFFSET_KEY = "kb-hero-rotation";

/**
 * A random number kept per visitor so two people in the same hour don't see
 * the same order. Only this offset is stored — nothing about which slides
 * were seen, and no view counts go anywhere.
 */
export function readVisitorOffset(): number {
  try {
    const saved = Number(localStorage.getItem(OFFSET_KEY));
    if (Number.isInteger(saved) && saved > 0) return saved;
    const fresh = 1 + Math.floor(Math.random() * 1_000_000);
    localStorage.setItem(OFFSET_KEY, String(fresh));
    return fresh;
  } catch {
    return 0;
  }
}

/** Changes every hour, so every eligible kitchen gets its turn at the front. */
export function rotationSeed(visitorOffset: number, now = Date.now()): number {
  return Math.floor(now / 3_600_000) * 7919 + visitorOffset;
}

export function selectHeroSlides({
  flashDeals,
  promotions,
  newKitchens,
  merchantsById,
  seed,
}: {
  flashDeals: KitchenDeal[];
  promotions: KitchenDeal[];
  newKitchens: Merchant[];
  merchantsById: ReadonlyMap<string, Merchant>;
  seed: number;
}): HeroSlide[] {
  const slides: HeroSlide[] = [...BRAND_ONLY];
  const used = new Set<string>();
  const add = (slide: Extract<HeroSlide, { kitchen: Merchant }>) => {
    if (slides.length >= MAX_HERO_SLIDES || used.has(slide.kitchen.id) || slide.kitchen.isBlocked) return false;
    used.add(slide.kitchen.id);
    slides.push(slide);
    return true;
  };
  const addDeals = (deals: KitchenDeal[], type: "flash" | "promotion", max: number) => {
    let added = 0;
    for (const deal of seededShuffle(deals, seed)) {
      const kitchen = merchantsById.get(deal.kitchenId);
      if (added >= max || !kitchen) continue;
      if (add({ type, key: `${type}-${deal.id}`, kitchen, deal, image: slideImage(kitchen) })) added++;
    }
  };
  addDeals(flashDeals, "flash", MAX_FLASH_SLIDES);
  addDeals(promotions, "promotion", MAX_PROMO_SLIDES);
  let added = 0;
  for (const kitchen of seededShuffle(newKitchens, seed)) {
    if (added >= MAX_NEW_KITCHEN_SLIDES) break;
    if (add({ type: "new-kitchen", key: `new-${kitchen.id}`, kitchen, image: slideImage(kitchen) })) added++;
  }
  return [...slides, ...BRAND_IMAGE_SLIDES];
}
