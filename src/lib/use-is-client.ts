"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true on every client render after
 * that (and on the first render of anything mounted client-side later). Lets a
 * component read browser-only state like localStorage without a hydration
 * mismatch — and without the "setState in an effect after mount" pattern.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
