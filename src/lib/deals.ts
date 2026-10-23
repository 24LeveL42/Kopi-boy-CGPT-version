import type { Merchant } from "@/lib/types";

/**
 * Kitchen deals — client-safe types and wording, display only. Every deal is
 * created and funded by its own kitchen; nothing here prices an order
 * (placeOrder() and checkout never read this). The data source doesn't
 * exist yet (Phase C adds it), so DealsFeed.available stays false and every
 * deal surface — card badges, Today's Deals, promotion and flash hero
 * slides — renders nothing until then.
 */
export type DealKind = "percent_off" | "amount_off" | "buy_x_get_y" | "free_item" | "min_spend" | "limited_qty" | "flash";

export const DEAL_KINDS: readonly DealKind[] = ["percent_off", "amount_off", "buy_x_get_y", "free_item", "min_spend", "limited_qty", "flash"];

export interface KitchenDeal {
  id: string;
  kitchenId: string;
  kind: DealKind;
  title: string;
  percentOff: number | null;
  amountOff: number | null;
  buyQty: number | null;
  getQty: number | null;
  itemName: string | null;
  minSpend: number | null;
  originalPrice: number | null;
  dealPrice: number | null;
  startsAt: string | null;
  endsAt: string | null;
  remainingQty: number | null;
}

/** available: false while the data source is missing — every deal surface hides. */
export interface DealsFeed {
  available: boolean;
  deals: KitchenDeal[];
}

export const NO_DEALS: DealsFeed = { available: false, deals: [] };

export const TODAYS_DEALS_LIMIT = 8;

export type DealBadgeKind = "deals" | "flash";

const positive = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0;
const money = (n: number) => `$${n.toFixed(2)}`;
const percent = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** Started, not ended, not sold out. A deal with no end time is never shown. */
export function isDealLive(deal: KitchenDeal, now: number): boolean {
  const starts = deal.startsAt ? Date.parse(deal.startsAt) : -Infinity;
  const ends = deal.endsAt ? Date.parse(deal.endsAt) : NaN;
  if (!Number.isFinite(ends) || Number.isNaN(starts)) return false;
  if (deal.remainingQty != null && deal.remainingQty <= 0) return false;
  return starts <= now && now < ends;
}

/**
 * The one place deal wording is built — badges, Today's Deals and hero
 * slides all use it. Only ever restates the kitchen's own numbers; null when
 * a number it needs is missing, and such a deal isn't shown at all.
 */
export function describeDeal(deal: KitchenDeal): { label: string; detail: string | null } | null {
  const item = deal.itemName?.trim() || null;
  const onItem = item ? ` ${item}` : "";
  const spend = positive(deal.minSpend) ? ` when you spend ${money(deal.minSpend)}` : "";
  const off = positive(deal.percentOff) && deal.percentOff <= 100 ? `${percent(deal.percentOff)} off` : positive(deal.amountOff) ? `${money(deal.amountOff)} off` : null;
  const left = deal.remainingQty != null && deal.remainingQty > 0 ? `Only ${deal.remainingQty} left` : null;

  switch (deal.kind) {
    case "percent_off":
      if (!positive(deal.percentOff) || deal.percentOff > 100) return null;
      return { label: `${percent(deal.percentOff)} off${onItem}${spend}`, detail: left };
    case "amount_off":
      if (!positive(deal.amountOff)) return null;
      return { label: `${money(deal.amountOff)} off${onItem}${spend}`, detail: left };
    case "buy_x_get_y":
      if (!positive(deal.buyQty) || !positive(deal.getQty)) return null;
      return { label: `Buy ${deal.buyQty}${onItem}, get ${deal.getQty} free`, detail: left };
    case "free_item":
      if (!item) return null;
      return { label: `Free ${item}${spend}`, detail: left };
    case "min_spend":
      if (!off || !spend) return null;
      return { label: `${off}${spend}`, detail: left };
    case "limited_qty": {
      const offer = off ? `${off}${onItem}` : item && positive(deal.dealPrice) ? `${item} ${money(deal.dealPrice)}` : null;
      if (!offer || !left) return null;
      return { label: offer, detail: left };
    }
    case "flash": {
      if (!positive(deal.dealPrice)) return null;
      const was = positive(deal.originalPrice) && deal.originalPrice > deal.dealPrice ? `Usually ${money(deal.originalPrice)}` : null;
      return { label: `${item ?? deal.title} ${money(deal.dealPrice)}`, detail: [was, left].filter(Boolean).join(" · ") || null };
    }
  }
}

/** "Ends in 25 min" / "Ends in 3 h"; null once it has ended. */
export function formatEndsIn(endsAt: string | null, now: number): string | null {
  const ends = endsAt ? Date.parse(endsAt) : NaN;
  if (!Number.isFinite(ends) || ends <= now) return null;
  const minutes = Math.ceil((ends - now) / 60_000);
  return minutes < 60 ? `Ends in ${minutes} min` : `Ends in ${Math.floor(minutes / 60)} h`;
}

/** Where tapping a deal goes: a flash deal opens that deal, any other deal the kitchen's deals section. */
export function dealHref(deal: KitchenDeal): string {
  return deal.kind === "flash" ? `/merchant/${deal.kitchenId}#deal-${deal.id}` : `/merchant/${deal.kitchenId}#deals`;
}

/** Deals that can be shown right now: live, worded, from a known kitchen that isn't blocked. */
export function showableDeals(feed: DealsFeed, merchantsById: ReadonlyMap<string, Merchant>, now: number): KitchenDeal[] {
  if (!feed.available) return [];
  return feed.deals.filter((d) => {
    const kitchen = merchantsById.get(d.kitchenId);
    return kitchen && !kitchen.isBlocked && isDealLive(d, now) && describeDeal(d) !== null;
  });
}

/** Card badge per kitchen: ⚡ FLASH wins over 🏷️ DEALS. */
export function dealBadges(deals: KitchenDeal[]): Map<string, DealBadgeKind> {
  const badges = new Map<string, DealBadgeKind>();
  for (const d of deals) {
    if (d.kind === "flash") badges.set(d.kitchenId, "flash");
    else if (!badges.has(d.kitchenId)) badges.set(d.kitchenId, "deals");
  }
  return badges;
}

/** "Today's Deals Near You": nearby kitchens only (when known), flash deals first, then ending soonest. */
export function selectTodaysDeals(deals: KitchenDeal[], nearbyIds: ReadonlySet<string> | null, limit = TODAYS_DEALS_LIMIT): KitchenDeal[] {
  return deals
    .filter((d) => !nearbyIds || nearbyIds.has(d.kitchenId))
    .sort((a, b) => Number(b.kind === "flash") - Number(a.kind === "flash") || Date.parse(a.endsAt ?? "") - Date.parse(b.endsAt ?? ""))
    .slice(0, limit);
}
