"use client";

import { useEffect, useMemo, useState } from "react";
import { findCustomerRegion } from "@/lib/home-actions";
import { toRegion, type RegionCode } from "@/lib/regions";
import { readPostalCode } from "@/lib/use-nearby-kitchens";
import { useIsClient } from "@/lib/use-is-client";

const CACHE_KEY = "kb-home-region";

function readCache(postalCode: string): RegionCode | null | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (!saved || saved.postalCode !== postalCode) return undefined;
    return saved.region === null ? null : (toRegion(saved.region) ?? undefined);
  } catch {
    return undefined;
  }
}

function writeCache(postalCode: string, region: RegionCode | null) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ postalCode, region }));
  } catch {
    // Private browsing, blocked storage: just ask again next time.
  }
}

/**
 * The customer's own region (src/lib/home-actions.ts findCustomerRegion), for
 * the home page order. Only asked while `enabled` (some kitchen has a
 * region), once per session and postal code. Null until known, and null
 * when the app has no saved postal code: then there is no region ordering.
 */
export function useCustomerRegion(enabled: boolean): RegionCode | null {
  const isClient = useIsClient();
  const postalCode = useMemo(() => (isClient ? readPostalCode() : ""), [isClient]);
  const cached = useMemo(() => (isClient && enabled ? readCache(postalCode) : undefined), [isClient, enabled, postalCode]);
  const [fetched, setFetched] = useState<{ postalCode: string; region: RegionCode | null } | null>(null);

  useEffect(() => {
    if (!isClient || !enabled || cached !== undefined) return;
    let cancelled = false;
    findCustomerRegion(postalCode).then(
      (region) => {
        if (cancelled) return;
        const clean = toRegion(region);
        writeCache(postalCode, clean);
        setFetched({ postalCode, region: clean });
      },
      () => !cancelled && setFetched({ postalCode, region: null })
    );
    return () => {
      cancelled = true;
    };
  }, [isClient, enabled, cached, postalCode]);

  if (!enabled) return null;
  if (cached !== undefined) return cached;
  return fetched?.postalCode === postalCode ? fetched.region : null;
}
