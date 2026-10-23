import { describe, it, expect } from "vitest";
import { NO_DEALS, dealBadges, dealHref, describeDeal, formatEndsIn, isDealLive, selectTodaysDeals, showableDeals, type KitchenDeal } from "@/lib/deals";
import { toKitchenDeal } from "@/lib/deals-server";
import type { Merchant } from "@/lib/types";

const NOW = Date.parse("2026-10-23T17:00:00Z");

function deal(overrides: Partial<KitchenDeal> = {}): KitchenDeal {
  return {
    id: "d-1", kitchenId: "k-1", kind: "percent_off", title: "Deepavali Special", percentOff: null, amountOff: null, buyQty: null, getQty: null,
    itemName: null, minSpend: null, originalPrice: null, dealPrice: null, startsAt: "2026-10-23T09:00:00Z", endsAt: "2026-10-23T18:00:00Z", remainingQty: null,
    ...overrides,
  };
}

describe("describeDeal — the one deal wording", () => {
  it("restates the kitchen's own numbers", () => {
    expect(describeDeal(deal({ kind: "percent_off", percentOff: 10, minSpend: 20 }))?.label).toBe("10% off when you spend $20.00");
    expect(describeDeal(deal({ kind: "amount_off", amountOff: 3, itemName: "Sweet Box" }))?.label).toBe("$3.00 off Sweet Box");
    expect(describeDeal(deal({ kind: "buy_x_get_y", buyQty: 2, getQty: 1, itemName: "Kaya Toast" }))?.label).toBe("Buy 2 Kaya Toast, get 1 free");
    expect(describeDeal(deal({ kind: "free_item", itemName: "Teh Tarik", minSpend: 15 }))?.label).toBe("Free Teh Tarik when you spend $15.00");
    expect(describeDeal(deal({ kind: "min_spend", amountOff: 5, minSpend: 30 }))?.label).toBe("$5.00 off when you spend $30.00");
    expect(describeDeal(deal({ kind: "limited_qty", percentOff: 20, itemName: "Curry Puff", remainingQty: 4 }))).toEqual({ label: "20% off Curry Puff", detail: "Only 4 left" });
  });

  it("words a flash deal with its usual price and what's left", () => {
    expect(describeDeal(deal({ kind: "flash", itemName: "Chicken Biryani", originalPrice: 8.5, dealPrice: 6.5, remainingQty: 15 }))).toEqual({
      label: "Chicken Biryani $6.50",
      detail: "Usually $8.50 · Only 15 left",
    });
  });

  it("returns null rather than inventing a missing number", () => {
    expect(describeDeal(deal({ kind: "percent_off" }))).toBeNull();
    expect(describeDeal(deal({ kind: "percent_off", percentOff: 150 }))).toBeNull();
    expect(describeDeal(deal({ kind: "buy_x_get_y", buyQty: 2 }))).toBeNull();
    expect(describeDeal(deal({ kind: "free_item" }))).toBeNull();
    expect(describeDeal(deal({ kind: "min_spend", percentOff: 10 }))).toBeNull();
    expect(describeDeal(deal({ kind: "limited_qty", percentOff: 10 }))).toBeNull();
    expect(describeDeal(deal({ kind: "flash" }))).toBeNull();
  });
});

describe("isDealLive / formatEndsIn", () => {
  it("is live only between start and end, and while stock remains", () => {
    expect(isDealLive(deal(), NOW)).toBe(true);
    expect(isDealLive(deal({ startsAt: "2026-10-23T17:30:00Z" }), NOW)).toBe(false);
    expect(isDealLive(deal({ endsAt: "2026-10-23T16:59:00Z" }), NOW)).toBe(false);
    expect(isDealLive(deal({ remainingQty: 0 }), NOW)).toBe(false);
    expect(isDealLive(deal({ endsAt: null }), NOW)).toBe(false);
  });

  it("counts down and goes null once ended", () => {
    expect(formatEndsIn("2026-10-23T17:25:00Z", NOW)).toBe("Ends in 25 min");
    expect(formatEndsIn("2026-10-23T20:30:00Z", NOW)).toBe("Ends in 3 h");
    expect(formatEndsIn("2026-10-23T16:00:00Z", NOW)).toBeNull();
  });
});

describe("deal surfaces", () => {
  const kitchen = (id: string, isBlocked = false) => ({ id, isBlocked }) as Merchant;
  const byId = new Map([kitchen("k-1"), kitchen("k-2"), kitchen("k-3", true)].map((k) => [k.id, k]));

  it("show nothing while the data source is missing", () => {
    expect(showableDeals(NO_DEALS, byId, NOW)).toEqual([]);
  });

  it("drop deals from unknown or blocked kitchens, expired deals and unworded deals", () => {
    const feed = {
      available: true,
      deals: [
        deal({ id: "ok", percentOff: 10 }),
        deal({ id: "blocked", kitchenId: "k-3", percentOff: 10 }),
        deal({ id: "unknown", kitchenId: "zz", percentOff: 10 }),
        deal({ id: "ended", percentOff: 10, endsAt: "2026-10-23T10:00:00Z" }),
        deal({ id: "unworded" }),
      ],
    };
    expect(showableDeals(feed, byId, NOW).map((d) => d.id)).toEqual(["ok"]);
  });

  it("FLASH wins over DEALS on a kitchen's badge", () => {
    const badges = dealBadges([deal({ kitchenId: "k-1" }), deal({ kitchenId: "k-1", kind: "flash" }), deal({ kitchenId: "k-2" })]);
    expect(badges.get("k-1")).toBe("flash");
    expect(badges.get("k-2")).toBe("deals");
  });

  it("Today's Deals: flash first, then ending soonest, at most 8, nearby only", () => {
    const list = Array.from({ length: 10 }, (_, i) => deal({ id: `d${i}`, kitchenId: "k-1", endsAt: `2026-10-23T${10 + i}:00:00Z` }));
    list.push(deal({ id: "flash", kitchenId: "k-1", kind: "flash", endsAt: "2026-10-23T23:00:00Z" }), deal({ id: "far", kitchenId: "k-2" }));
    const picked = selectTodaysDeals(list, new Set(["k-1"]));
    expect(picked).toHaveLength(8);
    expect(picked[0].id).toBe("flash");
    expect(picked[1].id).toBe("d0");
    expect(picked.some((d) => d.id === "far")).toBe(false);
  });

  it("links a flash deal to that deal and anything else to the kitchen's deals", () => {
    expect(dealHref(deal({ kind: "flash" }))).toBe("/merchant/k-1#deal-d-1");
    expect(dealHref(deal())).toBe("/merchant/k-1#deals");
  });

  it("maps a view row and rejects unknown kinds", () => {
    const row = { id: "d", kitchen_id: "k", kind: "flash", title: " T ", percent_off: null, amount_off: null, buy_qty: null, get_qty: null, item_name: "X", min_spend: null, original_price: "8.50", deal_price: "6.5", starts_at: null, ends_at: null, remaining_qty: 3 };
    expect(toKitchenDeal(row)).toMatchObject({ kitchenId: "k", title: "T", originalPrice: 8.5, dealPrice: 6.5, remainingQty: 3 });
    expect(toKitchenDeal({ ...row, kind: "points" })).toBeNull();
  });
});
