/**
 * Singapore regions — the coarse North / South / East / West label a
 * kitchen carries (kitchens.region, derived by the database from the cook's
 * private postal code; Partner repo docs/supabase-regions.sql). It is the
 * only location fact the region feature shows customers: never a postal
 * code, an address or coordinates.
 *
 * Tag colours: dark text on a light tint, each at least WCAG AA (4.5:1)
 * against white and against its own tint, none purple (the brand / active
 * chip) or green (Halal, NEW, Registered business). The tag always shows
 * the word, so colour is never the only signal. tests/regions.test.ts
 * checks all of that.
 */

export const REGION_CODES = ["north", "south", "east", "west"] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export const REGION_LABEL: Record<RegionCode, string> = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
};

export const REGION_COLOURS: Record<RegionCode, { text: string; background: string }> = {
  north: { text: "#1d4ed8", background: "#dbeafe" }, // blue
  south: { text: "#9a3412", background: "#ffedd5" }, // burnt orange
  east: { text: "#be123c", background: "#ffe4e6" }, // rose red
  west: { text: "#0e7490", background: "#cffafe" }, // cyan
};

/** A region code from the database, or null for anything else (null, unknown, wrong case). */
export function toRegion(value: unknown): RegionCode | null {
  return typeof value === "string" && (REGION_CODES as readonly string[]).includes(value) ? (value as RegionCode) : null;
}

/** Whether any merchant has a region — the region chips stay hidden until one does. */
export function anyRegion(merchants: readonly { region?: RegionCode | null }[]): boolean {
  return merchants.some((m) => m.region != null);
}

/**
 * The default order for the kitchen lists: nearby kitchens first, then the
 * customer's own region, then the other regions (North, South, East, West),
 * then kitchens with no region. Blocked kitchens stay after every
 * available one, as sortAvailableFirst already arranged. Inside each group
 * the given order is kept. Nothing is ever dropped: with no nearby
 * kitchens and no customer region, only the region grouping applies.
 */
export function orderByCloseness<T extends { id: string; region?: RegionCode | null; isBlocked?: boolean }>(
  merchants: readonly T[],
  { nearbyIds = null, customerRegion = null }: { nearbyIds?: ReadonlySet<string> | null; customerRegion?: RegionCode | null } = {}
): T[] {
  const rank = (m: T) => {
    if (nearbyIds?.has(m.id)) return 0;
    if (!m.region) return 2 + REGION_CODES.length;
    if (m.region === customerRegion) return 1;
    return 2 + REGION_CODES.indexOf(m.region);
  };
  return merchants
    .map((m, index) => ({ m, index, blocked: Number(!!m.isBlocked), rank: rank(m) }))
    .sort((a, b) => a.blocked - b.blocked || a.rank - b.rank || a.index - b.index)
    .map((x) => x.m);
}
