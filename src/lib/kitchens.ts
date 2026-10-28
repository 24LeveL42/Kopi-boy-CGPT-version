import { createClient } from "@/lib/supabase/server";
import { Merchant } from "@/lib/types";
import { sortAvailableFirst } from "@/lib/kitchen-availability";
import { isNewKitchen } from "@/lib/new-kitchens";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

interface KitchenRow {
  id: string;
  business_name: string;
  category: Merchant["category"];
  cuisine_type: Merchant["cuisineType"];
  /** First two digits of the kitchen's postal code (the Partner app never exposes the full code). */
  postal_sector?: string | null;
  description: string | null;
  hero_image: string | null;
  /** Null for home cooks; absent until the Partner app's schema section 27 runs (see selectKitchens). */
  business_uen?: string | null;
  /** Absent until docs/supabase-blocked-merchants.sql runs (see selectKitchens). */
  is_blocked?: boolean;
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
 * is for the rider assigned to an order, not for customers — only
 * postal_sector is shown. Never paynow_type/paynow_value, latitude/longitude
 * or acknowledged_terms_at either: docs/supabase-kitchen-privacy.sql hides
 * them from signed-out visitors (PayNow comes from get_order_paynow,
 * coordinates from loadKitchenLocations). And never "*": a column the
 * caller can't read fails the whole query ("permission denied") instead of
 * skipping that one column.
 */
export const KITCHEN_COLUMNS = ["id", "business_name", "category", "cuisine_type", "description", "hero_image"];
/** Added by Partner-app migrations that may not have run yet on a given database. */
export const OPTIONAL_KITCHEN_COLUMNS = ["business_uen", "postal_sector", "is_blocked"];

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
 * When each kitchen went live, for the NEW rule: kitchens.live_since where
 * that column exists and is set, else created_at. Read on its own so a
 * missing column (42703) only drops back to created_at, and any other error
 * (e.g. the column isn't granted to customers) means no kitchen counts as
 * new — the marketplace itself never fails over it.
 */
export async function loadLiveSince(supabase: ServerSupabase, kitchenIds: string[]): Promise<Map<string, string>> {
  for (const columns of ["id, live_since, created_at", "id, created_at"]) {
    const { data, error } = await supabase
      .from("kitchens")
      .select(columns)
      .in("id", kitchenIds)
      .returns<{ id: string; live_since?: string | null; created_at?: string | null }[]>();
    if (error) {
      if (error.code === "42703") continue;
      break;
    }
    const since = new Map<string, string>();
    for (const k of data ?? []) {
      const at = k.live_since ?? k.created_at;
      if (at) since.set(k.id, at);
    }
    return since;
  }
  return new Map();
}

/** 2 decimals is about 1.1 km: enough for the 8 km "near you" check, too coarse to find a home. */
export function roundCoordinate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

type LocationRow = { kitchen_id?: string; id?: string; latitude: unknown; longitude: unknown };

/**
 * Kitchen coordinates for "near you", rounded to 2 decimals. Read from the
 * kitchen_public_locations view (docs/supabase-kitchen-privacy.sql, already
 * rounded). Before that SQL runs the view doesn't exist, so it falls back to
 * kitchens.latitude/longitude and rounds them here, so the browser never gets
 * exact values either way. After the SQL, signed-out visitors can't read
 * those columns; any error just means no coordinates (no distance filter),
 * never a broken page.
 */
export async function loadKitchenLocations(supabase: ServerSupabase, kitchenIds: string[]): Promise<Map<string, { latitude: number; longitude: number }>> {
  const toMap = (rows: LocationRow[] | null) => {
    const out = new Map<string, { latitude: number; longitude: number }>();
    for (const r of rows ?? []) {
      const kitchenId = r.kitchen_id ?? r.id;
      const latitude = roundCoordinate(r.latitude);
      const longitude = roundCoordinate(r.longitude);
      if (kitchenId && latitude !== null && longitude !== null) out.set(kitchenId, { latitude, longitude });
    }
    return out;
  };
  const view = await supabase
    .from("kitchen_public_locations")
    .select("kitchen_id, latitude, longitude")
    .in("kitchen_id", kitchenIds)
    .returns<LocationRow[]>();
  if (!view.error) return toMap(view.data);
  const old = await supabase.from("kitchens").select("id, latitude, longitude").in("id", kitchenIds).returns<LocationRow[]>();
  return old.error ? new Map() : toMap(old.data);
}

/**
 * The only location a customer sees for a kitchen: "Postal sector 31", from
 * the first two digits of postal_sector — never the full 6-digit code. Works
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
 * rounded latitude/longitude from loadKitchenLocations. Ratings come from the
 * kitchen_rating_summary view (schema section 32); if that hasn't been
 * created yet the query errors and every kitchen just shows "No ratings
 * yet". `isNew` follows the NEW rule (src/lib/new-kitchens.ts) from
 * loadLiveSince. `demo-data.ts` (Feature #001) is no
 * longer used for the live home page; kept only for the test fixtures.
 */
export async function getLiveMerchants(): Promise<Merchant[]> {
  const supabase = await createClient();

  const { data: kitchens, error: kitchensError } = await selectKitchens((columns) =>
    supabase.from("kitchens").select(columns).eq("is_live", true).returns<KitchenRow[]>()
  );

  if (kitchensError) throw new Error(`Failed to load kitchens: ${kitchensError.message}`);
  if (!kitchens || kitchens.length === 0) return [];

  const kitchenIds = kitchens.map((k) => k.id);
  const [{ data: items, error: itemsError }, { data: summaries }, liveSince, locations] = await Promise.all([
    supabase.from("menu_items").select("*").in("kitchen_id", kitchenIds).order("created_at", { ascending: true }).returns<MenuItemRow[]>(),
    // Deliberately not fatal: before schema section 32 runs, the view doesn't
    // exist -> error -> no summaries, and the marketplace still loads.
    supabase.from("kitchen_rating_summary").select("kitchen_id, average, rating_count").in("kitchen_id", kitchenIds).returns<RatingSummaryRow[]>(),
    loadLiveSince(supabase, kitchenIds),
    loadKitchenLocations(supabase, kitchenIds),
  ]);

  if (itemsError) throw new Error(`Failed to load menu items: ${itemsError.message}`);

  const summaryByKitchen = new Map((summaries ?? []).map((s) => [s.kitchen_id, s]));
  const now = Date.now();

  const merchants = kitchens.map((k) => {
    const kitchenItems = (items ?? []).filter((i) => i.kitchen_id === k.id);
    const prices = kitchenItems.map((i) => i.price);
    const image = k.hero_image ?? CATEGORY_FALLBACK_IMAGE[k.category];
    const summary = summaryByKitchen.get(k.id);
    const since = liveSince.get(k.id) ?? null;
    const location = locations.get(k.id);

    return {
      id: k.id,
      name: k.business_name,
      category: k.category,
      cuisine: CUISINE_LABEL[k.cuisine_type],
      area: formatKitchenArea(k.postal_sector),
      blurb: k.description ?? "",
      rating: summary?.average ?? 0,
      ratingCount: summary?.rating_count ?? 0,
      etaMinutes: 30,
      distanceKm: null,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      priceFrom: prices.length > 0 ? Math.min(...prices) : 0,
      heroImage: image,
      avatarImage: image,
      cuisineType: k.cuisine_type,
      menuHighlights: kitchenItems.slice(0, 2).map((i) => ({ name: i.name, price: i.price })),
      isNew: isNewKitchen(since, now),
      liveSince: since,
      coverImage: k.hero_image ?? null,
      menuPhoto: kitchenItems.find((i) => i.photo_url)?.photo_url ?? null,
      businessUen: k.business_uen ?? null,
      isBlocked: k.is_blocked === true,
    };
  });
  return sortAvailableFirst(merchants);
}

export interface OrderPaynow {
  paynow_type: string | null;
  paynow_value: string | null;
}

/**
 * The cook's PayNow details for one order, from get_order_paynow()
 * (docs/supabase-kitchen-privacy.sql): only for the signed-in customer of
 * that order, and only once the cook has accepted it — kitchens.paynow_* are
 * hidden from the public. Until that SQL runs the function doesn't exist
 * (PGRST202 / 42883), so it falls back to reading the kitchen row as before.
 * Any other error, or no row, is null: the page then says "pay the cook via
 * PayNow" without a number.
 */
export async function loadOrderPaynow(supabase: ServerSupabase, orderId: string, kitchenId: string): Promise<OrderPaynow | null> {
  const { data, error } = await supabase.rpc("get_order_paynow", { p_order_id: orderId });
  // A set-returning function comes back as an array (untyped rpc(), hence the cast).
  if (!error) return (data as OrderPaynow[] | null)?.[0] ?? null;
  if (error.code !== "PGRST202" && error.code !== "42883") return null;
  const old = await supabase.from("kitchens").select("paynow_type, paynow_value").eq("id", kitchenId).maybeSingle<OrderPaynow>();
  return old.error ? null : (old.data ?? null);
}

/**
 * Whether a kitchen can take a new order, read fresh from the database —
 * never from anything the browser sends. "blocked" is HQ's block
 * (kitchens.is_blocked); "unavailable" is not found / not live. Before
 * docs/supabase-blocked-merchants.sql runs the column doesn't exist (42703),
 * so it falls back to the is_live check alone.
 */
export async function getKitchenOrderStatus(
  supabase: ServerSupabase,
  kitchenId: string
): Promise<"open" | "blocked" | "unavailable"> {
  const withBlocked = await supabase
    .from("kitchens")
    .select("id, is_live, is_blocked")
    .eq("id", kitchenId)
    .maybeSingle<{ id: string; is_live: boolean; is_blocked?: boolean }>();
  const { data: kitchen } =
    withBlocked.error?.code === "42703"
      ? await supabase.from("kitchens").select("id, is_live").eq("id", kitchenId).maybeSingle<{ id: string; is_live: boolean; is_blocked?: boolean }>()
      : withBlocked;
  if (!kitchen || !kitchen.is_live) return "unavailable";
  return kitchen.is_blocked ? "blocked" : "open";
}
