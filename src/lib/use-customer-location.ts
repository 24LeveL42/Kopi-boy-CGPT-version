"use client";

import { useCallback, useState } from "react";
import { useIsClient } from "@/lib/use-is-client";

const STORAGE_KEY = "kb-customer-location";

export type LocationStatus = "idle" | "locating" | "granted" | "denied" | "unavailable" | "unsupported";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * One-time, client-only location capture — not a live profile field (see
 * docs/supabase-schema.sql's customer_lat/customer_lng on orders). Cached in
 * localStorage purely so a location granted once (e.g. at checkout) also
 * lights up real distances on the marketplace cards without re-prompting on
 * every page; never sent anywhere until an order is actually placed.
 */
export function useCustomerLocation() {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [loadedCache, setLoadedCache] = useState(false);
  const isClient = useIsClient();

  // Pick up a cached location once, on the first client render (adjusting
  // state during render rather than in an effect after mount).
  if (isClient && !loadedCache) {
    setLoadedCache(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setCoords(JSON.parse(raw));
        setStatus("granted");
      }
    } catch {
      // Private browsing, blocked storage, etc. — just skip the cached location.
    }
  }

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setCoords(next);
        setStatus("granted");
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore — see above.
        }
      },
      (geoError) => {
        setStatus(geoError.code === geoError.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  }, []);

  return { coords, status, requestLocation };
}
