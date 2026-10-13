"use client";

import { useCallback, useState } from "react";
import { useIsClient } from "@/lib/use-is-client";

const STORAGE_KEY = "kb-delivery-postal-code";

/**
 * The delivery postal code typed at checkout. The last one that was found
 * is remembered in localStorage so a returning customer doesn't retype it;
 * it's only ever sent to the server to quote the fee and place the order.
 */
export function useDeliveryPostalCode() {
  const [postalCode, setPostalCode] = useState("");
  const [loadedCache, setLoadedCache] = useState(false);
  const isClient = useIsClient();

  // Pick up the remembered code once, on the first client render (adjusting
  // state during render rather than in an effect after mount).
  if (isClient && !loadedCache) {
    setLoadedCache(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && /^\d{6}$/.test(saved)) setPostalCode(saved);
    } catch {
      // Private browsing, blocked storage, etc. — just start empty.
    }
  }

  const remember = useCallback((code: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Ignore — see above.
    }
  }, []);

  return { postalCode, setPostalCode, remember };
}
