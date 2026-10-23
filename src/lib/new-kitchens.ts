import type { Merchant } from "@/lib/types";

/**
 * "New" kitchens — display only. A kitchen counts as new for this many days
 * after it went live. Kept as one constant so it can later be read from a
 * settings table instead.
 */
export const NEW_KITCHEN_DAYS = 14;
/** "New Kitchens Near You" only shows kitchens within this distance of the customer's delivery location. */
export const NEW_KITCHENS_RADIUS_KM = 8;
export const NEW_KITCHENS_LIMIT = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True while a kitchen is inside its first NEW_KITCHEN_DAYS. A missing or
 * unreadable date is never new, so nothing gets the NEW pill by accident.
 */
export function isNewKitchen(liveSince: string | null | undefined, now: number, days = NEW_KITCHEN_DAYS): boolean {
  if (!liveSince) return false;
  const since = Date.parse(liveSince);
  if (!Number.isFinite(since)) return false;
  return now - since < days * DAY_MS;
}

/**
 * The "New Kitchens Near You" list: new, not blocked, inside `nearbyIds`
 * when the customer's location is known (null = no distance filter), not
 * already in `excludeIds`, newest first.
 */
export function selectNewKitchens(
  merchants: Merchant[],
  { nearbyIds, excludeIds = new Set<string>(), limit = NEW_KITCHENS_LIMIT }: { nearbyIds: ReadonlySet<string> | null; excludeIds?: ReadonlySet<string>; limit?: number }
): Merchant[] {
  return merchants
    .filter((m) => m.isNew && !m.isBlocked && !excludeIds.has(m.id) && (!nearbyIds || nearbyIds.has(m.id)))
    .sort((a, b) => (Date.parse(b.liveSince ?? "") || 0) - (Date.parse(a.liveSince ?? "") || 0))
    .slice(0, limit);
}
