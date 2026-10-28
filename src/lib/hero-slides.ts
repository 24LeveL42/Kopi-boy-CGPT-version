import type { Merchant } from "@/lib/types";
import type { KitchenDeal } from "@/lib/deals";

/**
 * NOT RENDERED since the carousel became images only (HERO_IMAGES below);
 * kept so the live slides can come back. Was: which slides the home hero
 * carousel shows — display only. Slide A is
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

/**
 * What the home hero carousel shows: these designed images, nothing else
 * (the brand card and the deal / new-kitchen slides above are kept but no
 * longer rendered). Played in this order, each for HERO_SLIDE_MS. Logo and
 * headline are drawn on the left of every image, so the alt text repeats the
 * wording and the frame keeps the left side (object-position left center).
 * `zoom` (a CSS scale around `zoomOrigin`) trims the screenshot edges and
 * rounded corners baked into the files: the smallest zoom, per image, that
 * hides them in the 16:9 frame without cutting the logo, text or button.
 * A seasonal image has a `window` of Singapore dates, both days included;
 * outside it the image is skipped.
 */
export interface HeroImage {
  key: string;
  src: string;
  alt: string;
  linksToAllCooks: boolean;
  zoom: number;
  zoomOrigin: string;
  window?: { from: string; to: string };
}

export const HERO_IMAGES: readonly HeroImage[] = [
  { key: "01-browse", src: "/hero/01-browse.webp", alt: "Something good is cooking nearby. Order straight from the people who make it. Browse all cooks and stalls.", linksToAllCooks: true, zoom: 1.04, zoomOrigin: "25% 40%" },
  { key: "02-real-people", src: "/hero/02-real-people.webp", alt: "Real people. Real food. Support home cooks, hawkers, bakeries and small businesses in your area.", linksToAllCooks: false, zoom: 1.03, zoomOrigin: "30% 60%" },
  { key: "03-riders", src: "/hero/03-riders.webp", alt: "Delivering goodness together. Riders keep your favourite food moving across the island: fair rates, flexible time, no commission.", linksToAllCooks: false, zoom: 1.04, zoomOrigin: "30% 75%" },
  { key: "04-simple", src: "/hero/04-simple.webp", alt: "Your favourite food, made simple. Discover, order, track, enjoy.", linksToAllCooks: false, zoom: 1.03, zoomOrigin: "30% 70%" },
  { key: "05-community", src: "/hero/05-community.webp", alt: "Good food, stronger community. Support local cooks, empower riders, and keep our neighbourhoods thriving.", linksToAllCooks: false, zoom: 1.105, zoomOrigin: "85% 35%" },
  { key: "06-islandwide", src: "/hero/06-islandwide.webp", alt: "Good food islandwide. From your neighbourhood to your doorstep.", linksToAllCooks: false, zoom: 1.05, zoomOrigin: "65% 75%" },
  { key: "07-deepavali", src: "/hero/07-deepavali.webp", alt: "Deepavali special deals. Celebrate with delicious local food from home cooks, hawkers and small businesses. Order festive food.", linksToAllCooks: true, zoom: 1.03, zoomOrigin: "20% 15%", window: { from: "2026-10-28", to: "2026-11-09" } },
  { key: "08-cny", src: "/hero/08-cny.webp", alt: "Chinese New Year 2027 special deals. Welcome the Year of the Goat with great food and good times. Order CNY food.", linksToAllCooks: true, zoom: 1.03, zoomOrigin: "20% 45%", window: { from: "2027-01-15", to: "2027-02-17" } },
  { key: "09-hari-raya", src: "/hero/09-hari-raya.webp", alt: "Hari Raya special deals. Enjoy delicious local food from home cooks, hawkers and small businesses. Order Raya food.", linksToAllCooks: true, zoom: 1.03, zoomOrigin: "20% 25%", window: { from: "2027-02-20", to: "2027-03-20" } },
  { key: "10-christmas", src: "/hero/10-christmas.webp", alt: "Christmas special deals. Share the joy of good food with family and friends this festive season. Order Christmas food.", linksToAllCooks: true, zoom: 1.035, zoomOrigin: "25% 40%", window: { from: "2026-12-01", to: "2026-12-26" } },
];

/** Today's date in Singapore (UTC+8 all year, no daylight saving) as YYYY-MM-DD. */
export function singaporeDate(now: number): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function isHeroImageShowing(image: HeroImage, now: number): boolean {
  if (!image.window) return true;
  const today = singaporeDate(now);
  return today >= image.window.from && today <= image.window.to;
}

export function showingHeroImages(now: number, images: readonly HeroImage[] = HERO_IMAGES): HeroImage[] {
  return images.filter((image) => isHeroImageShowing(image, now));
}

/**
 * The image after `currentKey`, always moving forward through the list and
 * wrapping from the last to the first, skipping any seasonal image outside
 * its window right now.
 */
export function nextHeroImage(currentKey: string, now: number, images: readonly HeroImage[] = HERO_IMAGES): HeroImage {
  const at = images.findIndex((image) => image.key === currentKey);
  for (let step = 1; step <= images.length; step++) {
    const candidate = images[(at + step + images.length) % images.length];
    if (isHeroImageShowing(candidate, now)) return candidate;
  }
  return images[Math.max(at, 0)];
}

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
