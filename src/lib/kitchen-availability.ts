/**
 * Blocked merchants — client-safe pieces. A kitchen is blocked when HQ (Boss
 * app) sets its cook's profiles.is_active = false; the database mirrors that
 * onto kitchens.is_blocked (docs/supabase-blocked-merchants.sql). Customers
 * are never told why — only these fixed strings.
 */
export const UNAVAILABLE_LABEL = "Currently unavailable";
export const UNAVAILABLE_ORDER_MESSAGE = "This kitchen is currently unavailable.";

/** Available kitchens first, blocked ones after; otherwise keeps the given order. */
export function sortAvailableFirst<T extends { isBlocked?: boolean }>(merchants: T[]): T[] {
  return [...merchants].sort((a, b) => Number(!!a.isBlocked) - Number(!!b.isBlocked));
}
