"use client";

import { useEffect, useState } from "react";

/** The current time, refreshed every `everyMs` — so deals and countdowns drop off when they end while the page is open. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
