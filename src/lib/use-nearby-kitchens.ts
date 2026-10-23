"use client";

import { useEffect, useMemo, useState } from "react";
import { findNearbyKitchenIds } from "@/lib/home-actions";
import { resolveNearby, type KitchenPoint, type LatLng, type OriginSource, type ServerNearby } from "@/lib/home-location";
import { NEW_KITCHENS_RADIUS_KM } from "@/lib/new-kitchens";
import { useIsClient } from "@/lib/use-is-client";
import type { Merchant } from "@/lib/types";

const CACHE_KEY = "kb-home-nearby";
const CACHE_TTL_MS = 10 * 60_000;
/** Past this the home page stops waiting for the server and uses what the browser has. */
export const NEARBY_FALLBACK_MS = 1_500;
const POSTAL_KEY = "kb-delivery-postal-code";

function readPostalCode(): string {
  try {
    const saved = localStorage.getItem(POSTAL_KEY) ?? "";
    return /^\d{6}$/.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

function readCache(key: string): ServerNearby | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (saved?.key !== key || Date.now() - saved.at > CACHE_TTL_MS) return null;
    return saved.result as ServerNearby;
  } catch {
    return null;
  }
}

function writeCache(key: string, result: ServerNearby) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ key, at: Date.now(), result }));
  } catch {
    // Private browsing, blocked storage — just ask again next time.
  }
}

/**
 * Which kitchens are "near you" for the home page, following the location
 * order in src/lib/home-location.ts. The server's answer is cached for the
 * session (ids only), and the page never waits more than
 * NEARBY_FALLBACK_MS for it. `ready` is false until then, so sections that
 * depend on it don't flash one list and swap to another.
 */
export function useNearbyKitchens(merchants: Merchant[], browser: LatLng | null): { ready: boolean; source: OriginSource; nearbyIds: Set<string> | null } {
  const isClient = useIsClient();
  const points = useMemo<KitchenPoint[]>(() => merchants.map((m) => ({ id: m.id, latitude: m.latitude, longitude: m.longitude })), [merchants]);
  const postalCode = useMemo(() => (isClient ? readPostalCode() : ""), [isClient]);
  const key = useMemo(() => `${postalCode}|${points.map((p) => p.id).join(",")}`, [postalCode, points]);
  const cached = useMemo(() => (isClient ? readCache(key) : null), [isClient, key]);
  const [fetched, setFetched] = useState<{ key: string; result: ServerNearby } | null>(null);
  const [gaveUp, setGaveUp] = useState<string | null>(null);

  useEffect(() => {
    if (!isClient || cached) return;
    let cancelled = false;
    const timer = setTimeout(() => !cancelled && setGaveUp(key), NEARBY_FALLBACK_MS);
    findNearbyKitchenIds(postalCode, points).then(
      (result) => {
        if (cancelled) return;
        writeCache(key, result);
        setFetched({ key, result });
      },
      () => !cancelled && setFetched({ key, result: { source: "none", nearbyIds: [] } })
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isClient, cached, key, postalCode, points]);

  const server = cached ?? (fetched?.key === key ? fetched.result : null);
  const ready = server !== null || gaveUp === key;
  const resolved = useMemo(() => resolveNearby(server, browser, points, NEW_KITCHENS_RADIUS_KM), [server, browser, points]);
  return { ready, ...resolved };
}
