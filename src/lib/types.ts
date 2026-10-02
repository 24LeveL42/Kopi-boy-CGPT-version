/**
 * Domain types — Feature #001 scope.
 *
 * Only what the customer marketplace needs to render is modeled here.
 * Order/payment/delivery/rating state machines from the handover doc
 * (sections 24) are intentionally NOT modeled yet — they belong to
 * Features #005–#010. Do not expand this file to cover them early;
 * add a new file per feature so this stays a marketplace-only model.
 */

export type MerchantCategory = "home-cook" | "hawker" | "bulk-orders" | "bakery" | "drinks";

export type CuisineType = "chinese" | "halal" | "indian" | "western";

export interface CuisineDef {
  id: CuisineType | "all";
  label: string;
}

export interface CategoryDef {
  id: MerchantCategory | "all";
  label: string;
}

export interface MenuHighlight {
  name: string;
  price: number; // SGD
}

export interface Merchant {
  id: string;
  name: string;
  category: MerchantCategory;
  cuisine: string;
  /**
   * "Postal sector 31" (formatKitchenArea in src/lib/kitchens.ts) — the only
   * location shown to customers, never the street address or full postal
   * code. Null until the Partner app's migration adds postal_code, or when
   * the cook hasn't set it.
   */
  area: string | null;
  blurb: string;
  rating: number; // 0-5, average of ratings (0 when ratingCount is 0)
  ratingCount: number;
  etaMinutes: number;
  // null until the customer has shared their location (see
  // src/lib/use-customer-location.ts) and the kitchen has coordinates of its
  // own — computed client-side via Haversine, not stored on the kitchen row.
  distanceKm: number | null;
  latitude: number | null;
  longitude: number | null;
  priceFrom: number; // SGD, cheapest menu item
  heroImage: string;
  avatarImage: string;
  cuisineType: CuisineType;
  menuHighlights: MenuHighlight[];
  isNew?: boolean;
  /** From the cook's HQ-approved application (never self-set) — backs the "Registered business" badge. */
  businessUen?: string | null;
}
