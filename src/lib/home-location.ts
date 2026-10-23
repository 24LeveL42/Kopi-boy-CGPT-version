import { haversineDistanceKm } from "@/lib/distance";

/**
 * Where "near you" is measured from on the home page — display only. Tried
 * in this order: the signed-in customer's default saved address, then the
 * postal code remembered from checkout (both resolved on the server, see
 * src/lib/home-actions.ts, so their coordinates never reach the browser),
 * then a browser location the customer already shared (never sent to the
 * server, see src/lib/use-customer-location.ts). With none of them there is
 * no distance filter.
 */
export type OriginSource = "saved-address" | "postal-code" | "browser" | "none";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface KitchenPoint {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

type Step<S extends OriginSource> = readonly [S, () => LatLng | null | Promise<LatLng | null>];

/** Tries each step in order and stops at the first one that finds a location; later steps never run. */
export async function firstOrigin<S extends OriginSource>(steps: readonly Step<S>[]): Promise<{ source: S | "none"; origin: LatLng | null }> {
  for (const [source, find] of steps) {
    const origin = await find();
    if (origin) return { source, origin };
  }
  return { source: "none", origin: null };
}

/** Ids of the kitchens within `radiusKm` of `origin`; kitchens without coordinates are left out. */
export function kitchensWithin(origin: LatLng, kitchens: KitchenPoint[], radiusKm: number): string[] {
  return kitchens
    .filter((k) => k.latitude != null && k.longitude != null && haversineDistanceKm(origin.latitude, origin.longitude, k.latitude, k.longitude) <= radiusKm)
    .map((k) => k.id);
}

/** What the server found (saved address / postal code), or "none". */
export interface ServerNearby {
  source: "saved-address" | "postal-code" | "none";
  nearbyIds: string[];
}

/**
 * Finishes the location order on the client: the server's answer when it
 * found a location, else the shared browser location, else no filter
 * (nearbyIds null).
 */
export function resolveNearby(
  server: ServerNearby | null,
  browser: LatLng | null,
  kitchens: KitchenPoint[],
  radiusKm: number
): { source: OriginSource; nearbyIds: Set<string> | null } {
  if (server && server.source !== "none") return { source: server.source, nearbyIds: new Set(server.nearbyIds) };
  if (browser) return { source: "browser", nearbyIds: new Set(kitchensWithin(browser, kitchens, radiusKm)) };
  return { source: "none", nearbyIds: null };
}
