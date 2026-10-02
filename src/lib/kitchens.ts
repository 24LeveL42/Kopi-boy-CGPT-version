import { createClient } from "@/lib/supabase/server";
import { Merchant } from "@/lib/types";

interface KitchenRow {
  id: string;
  business_name: string;
  category: Merchant["category"];
  cuisine_type: Merchant["cuisineType"];
  /** Absent until the Partner app's business-address migration runs (see selectKitchens). */
  postal_code?: string | null;
  description: string | null;
  hero_image: string | null;
  /** Null for home cooks; absent until the Partner app's schema section 27 runs (see selectKitchens). */
  business_uen?: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface RatingSummaryRow {
  kitchen_id: string;
  average: number;
  rating_count: number;
}

interface MenuItemRow {
  id: string;
  kitchen_id: string;
  name: string;
  price: number;
  photo_url: string | null;
}

const CUISINE_LABEL: Record<Merchant["cuisineType"], string> = {
  chinese: "Chinese",
  halal: "Halal",
  indian: "Indian",
  western: "Western",
};

const CATEGORY_FALLBACK_IMAGE: Record<Merchant["category"], string> = {
  "home-cook": "/categories/home-cooks.jpg",
  hawker: "/categories/hawkers.jpg",
  bakery: "/categories/bakers.jpg",
  "bulk-orders": "/categories/bulk-orders.jpg",
  drinks: "/categories/drinks-desserts.jpg",
};

/**
 * The kitchen columns a customer may read. Deliberately never
 * business_address: a kitchen's street address (often a home cook's home)
 * is for the rider/picker assigned to an order, not for customers — only
 * postal_code is shown. And never "*": once the Partner app revokes SELECT
 * on business_address, `select *` fails the whole query ("permission
 * denied") instead of skipping that one column.
 */
const KITCHEN_COLUMNS = ["id", "business_name", "category", "cuisine_type", "description", "hero_image", "latitude", "longitude"];
/** Added by Partner-app migrations that may not have run yet on a given database. */
const OPTIONAL_KITCHEN_COLUMNS = ["business_uen", "postal_code"];

/**
 * Runs a kitchens query with KITCHEN_COLUMNS plus whichever optional columns
 * exist. Naming a column that doesn't exist fails the query (42703), so on
 * that error the missing column is dropped and the query retried — the page
 * keeps working, minus that one field, until the migration runs.
 */
export async function selectKitchens<R extends { error: { code?: string; message: string } | null }>(
  run: (columns: string) => PromiseLike<R>
): Promise<R> {
  let optional = OPTIONAL_KITCHEN_COLUMNS;
  for (;;) {
    const result = await run([...KITCHEN_COLUMNS, ...optional].join(", "));
    const message = result.error?.code === "42703" ? result.error.message : null;
    const missing = message ? optional.find((c) => message.includes(`.${c} `)) : undefined;
    if (!missing) return result;
    optional = optional.filter((c) => c !== missing);
  }
}

/**
 * The only location a customer sees for a kitchen: "Postal sector 31", from
 * the first two digits of postal_code — never the full 6-digit code. Works
 * whether the Partner app exposes the full code or already only the sector.
 * Null when there's no usable code.
 */
export function formatKitchenArea(postalCode: string | null | undefined): string | null {
  const sector = postalCode?.trim().match(/^\d{2}/)?.[0];
  return sector ? `Postal sector ${sector}` : null;
}

/**
 * Real merchants for the marketplace — Feature #003.
 *
 * ETA isn't modeled yet, so it's a fixed placeholder here rather than
 * computed. Distance is left null here on purpose — it depends on the
 * customer's own location, which this server-side fetch has no access to;
 * <Marketplace> computes it client-side (Haversine, see src/lib/distance.ts)
 * once the customer has shared their location, using the kitchen's
 * latitude/longitude passed through below. Ratings come from the
 * kitchen_rating_summary view (schema section 32); if that hasn't been
 * created yet the query errors and every kitchen just shows "No ratings
 * yet". `isNew` is still a placeholder (true for every kitchen). `demo-data.ts` (Feature #001) is no
 * longer used for the live home page; kept only for the test fixtures.
 */
export async function getLiveMerchants(): Promise<Merchant[]> {
  const supabase = await createClient();

  const { data: kitchens, error: kitchensError } = await selectKitchens((columns) =>
    supabase.from("kitchens").select(columns).eq("is_live", true).returns<KitchenRow[]>()
  );

  if (kitchensError) throw new Error(`Failed to load kitchens: ${kitchensError.message}`);
  if (!kitchens || kitchens.length === 0) return [];

  const { data: items, error: itemsError } = await supabase
    .from("menu_items")
    .select("*")
    .in(
      "kitchen_id",
      kitchens.map((k) => k.id)
    )
    .order("created_at", { ascending: true })
    .returns<MenuItemRow[]>();

  if (itemsError) throw new Error(`Failed to load menu items: ${itemsError.message}`);

  // Deliberately not fatal: before schema section 32 runs, the view doesn't
  // exist -> error -> no summaries, and the marketplace still loads.
  const { data: summaries } = await supabase
    .from("kitchen_rating_summary")
    .select("kitchen_id, average, rating_count")
    .in(
      "kitchen_id",
      kitchens.map((k) => k.id)
    )
    .returns<RatingSummaryRow[]>();
  const summaryByKitchen = new Map((summaries ?? []).map((s) => [s.kitchen_id, s]));

  return kitchens.map((k) => {
    const kitchenItems = (items ?? []).filter((i) => i.kitchen_id === k.id);
    const prices = kitchenItems.map((i) => i.price);
    const image = k.hero_image ?? CATEGORY_FALLBACK_IMAGE[k.category];
    const summary = summaryByKitchen.get(k.id);

    return {
      id: k.id,
      name: k.business_name,
      category: k.category,
      cuisine: CUISINE_LABEL[k.cuisine_type],
      area: formatKitchenArea(k.postal_code),
      blurb: k.description ?? "",
      rating: summary?.average ?? 0,
      ratingCount: summary?.rating_count ?? 0,
      etaMinutes: 30,
      distanceKm: null,
      latitude: k.latitude,
      longitude: k.longitude,
      priceFrom: prices.length > 0 ? Math.min(...prices) : 0,
      heroImage: image,
      avatarImage: image,
      cuisineType: k.cuisine_type,
      menuHighlights: kitchenItems.slice(0, 2).map((i) => ({ name: i.name, price: i.price })),
      isNew: true,
      businessUen: k.business_uen ?? null,
    };
  });
}
