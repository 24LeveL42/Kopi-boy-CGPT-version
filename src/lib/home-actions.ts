"use server";

import { createClient } from "@/lib/supabase/server";
import { geocodePostalCode } from "@/lib/geocode";
import { NEW_KITCHENS_RADIUS_KM } from "@/lib/new-kitchens";
import { firstOrigin, kitchensWithin, type KitchenPoint, type LatLng, type ServerNearby } from "@/lib/home-location";

const MAX_KITCHENS = 1000;
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_SIZE = 500;
// Postal code -> coordinates, per server instance. Postal codes don't move,
// so this keeps the home page from waiting on OneMap for a code it has seen.
const geocodeCache = new Map<string, { at: number; origin: LatLng | null }>();

async function geocodeCached(postalCode: string): Promise<LatLng | null> {
  const hit = geocodeCache.get(postalCode);
  if (hit && Date.now() - hit.at < GEOCODE_TTL_MS) return hit.origin;
  const geo = await geocodePostalCode(postalCode);
  // "unavailable" is OneMap having a bad moment — don't remember it.
  if (!geo.ok && geo.reason === "unavailable") return null;
  const origin = geo.ok ? { latitude: geo.lat, longitude: geo.lng } : null;
  geocodeCache.delete(postalCode);
  geocodeCache.set(postalCode, { at: Date.now(), origin });
  if (geocodeCache.size > GEOCODE_CACHE_SIZE) geocodeCache.delete(geocodeCache.keys().next().value!);
  return origin;
}

function cleanKitchens(kitchens: unknown): KitchenPoint[] {
  if (!Array.isArray(kitchens)) return [];
  return kitchens.slice(0, MAX_KITCHENS).flatMap((k) => {
    const id = typeof k?.id === "string" ? k.id : null;
    const latitude = Number(k?.latitude);
    const longitude = Number(k?.longitude);
    return id && Number.isFinite(latitude) && Number.isFinite(longitude) ? [{ id, latitude, longitude }] : [];
  });
}

/**
 * "New Kitchens Near You": which of the given kitchens are within
 * NEW_KITCHENS_RADIUS_KM of the signed-in customer's default saved address,
 * else of the postal code remembered from checkout. Returns kitchen ids only
 * — the customer's coordinates stay on the server. Signed-out customers get
 * "none" (no open geocoding proxy, same as lookupPostalCode), and the browser
 * then falls back to a location it already has (resolveNearby). Display only.
 */
export async function findNearbyKitchenIds(postalCode: string, kitchens: KitchenPoint[]): Promise<ServerNearby> {
  const none: ServerNearby = { source: "none", nearbyIds: [] };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return none;

  const code = String(postalCode ?? "").trim();
  const { source, origin } = await firstOrigin([
    [
      "saved-address",
      async () => {
        const { data, error } = await supabase
          .from("customer_addresses")
          .select("lat, lng")
          .eq("user_id", user.id)
          .eq("is_default", true)
          .maybeSingle<{ lat: number | string; lng: number | string }>();
        // A missing table (SQL not run yet) or any error just moves on to the postal code.
        if (error || !data) return null;
        const latitude = Number(data.lat);
        const longitude = Number(data.lng);
        return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
      },
    ],
    ["postal-code", () => (/^\d{6}$/.test(code) ? geocodeCached(code) : null)],
  ] as const);
  if (!origin || source === "none") return none;
  return { source, nearbyIds: kitchensWithin(origin, cleanKitchens(kitchens), NEW_KITCHENS_RADIUS_KM) };
}
