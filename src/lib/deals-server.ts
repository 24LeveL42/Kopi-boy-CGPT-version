import "server-only";

import { createClient } from "@/lib/supabase/server";
import { DEAL_KINDS, NO_DEALS, isDealLive, type DealKind, type DealsFeed, type KitchenDeal } from "@/lib/deals";

/**
 * The read-only view docs/supabase-promotions.sql PART 1 adds (approved,
 * live kitchens' currently running deals, empty while
 * app_settings.deals_enabled is off) and the columns the Customer app reads
 * from it. Until it exists the query errors and every deal surface stays
 * hidden — the same way ratings degrade before kitchen_rating_summary exists.
 */
export const DEALS_VIEW = "kitchen_active_deals";
const DEAL_COLUMNS =
  "id, kitchen_id, kind, title, percent_off, amount_off, buy_qty, get_qty, item_name, min_spend, original_price, deal_price, starts_at, ends_at, remaining_qty";

interface DealRow {
  id: string;
  kitchen_id: string;
  kind: string;
  title: string | null;
  percent_off: number | string | null;
  amount_off: number | string | null;
  buy_qty: number | null;
  get_qty: number | null;
  item_name: string | null;
  min_spend: number | string | null;
  original_price: number | string | null;
  deal_price: number | string | null;
  starts_at: string | null;
  ends_at: string | null;
  remaining_qty: number | null;
}

const num = (v: number | string | null) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function toKitchenDeal(row: DealRow): KitchenDeal | null {
  if (!DEAL_KINDS.includes(row.kind as DealKind)) return null;
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    kind: row.kind as DealKind,
    title: row.title?.trim() ?? "",
    percentOff: num(row.percent_off),
    amountOff: num(row.amount_off),
    buyQty: num(row.buy_qty),
    getQty: num(row.get_qty),
    itemName: row.item_name,
    minSpend: num(row.min_spend),
    originalPrice: num(row.original_price),
    dealPrice: num(row.deal_price),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    remainingQty: num(row.remaining_qty),
  };
}

/** Live deals for the home page; { available: false } on any error, including the view not existing yet. */
export async function getActiveDeals(): Promise<DealsFeed> {
  const supabase = await createClient();
  const { data, error } = await supabase.from(DEALS_VIEW).select(DEAL_COLUMNS).returns<DealRow[]>();
  if (error || !data) return NO_DEALS;
  const now = Date.now();
  return { available: true, deals: data.flatMap((row) => toKitchenDeal(row) ?? []).filter((d) => isDealLive(d, now)) };
}
