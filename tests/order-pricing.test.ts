import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatDealAmount,
  orderDiscount,
  orderFoodTotal,
  parseOrderPricing,
  parsePricingChange,
  pricingChangedPrompt,
} from "@/lib/order-pricing";
import { quoteOrderPricing } from "@/lib/pricing-actions";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

describe("order money", () => {
  it("reads an order without the deal columns (placed before PART 2) as no deal", () => {
    expect(orderDiscount({ subtotal: 12.5 })).toBe(0);
    expect(orderFoodTotal({ subtotal: 12.5 })).toBe(12.5);
  });

  it("uses food_total when there is one, and subtotal - discount when it's missing", () => {
    expect(orderFoodTotal({ subtotal: 12.5, discount_total: 2.5, food_total: 10 })).toBe(10);
    expect(orderFoodTotal({ subtotal: 12.5, discount_total: "2.50", food_total: null })).toBe(10);
    expect(orderDiscount({ subtotal: 12.5, discount_total: "2.50" })).toBe(2.5);
    expect(orderDiscount({ subtotal: 12.5, discount_total: 0 })).toBe(0);
  });

  it("formats the Deal line", () => {
    expect(formatDealAmount(1.5)).toBe("-$1.50");
  });
});

describe("parsing the database's pricing", () => {
  it("reads quote_order_pricing's answer", () => {
    expect(parseOrderPricing({ subtotal: 7, discount_total: 1.4, food_total: 5.6, promotion_label: " 20% off " })).toEqual({
      subtotal: 7,
      discountTotal: 1.4,
      foodTotal: 5.6,
      promotionLabel: "20% off",
    });
  });

  it("refuses anything incomplete or negative", () => {
    expect(parseOrderPricing(null)).toBeNull();
    expect(parseOrderPricing({ subtotal: 7, food_total: 7 })).toBeNull();
    expect(parseOrderPricing({ subtotal: 7, discount_total: -1, food_total: 8 })).toBeNull();
  });

  it("reads pricing_changed details and adds up the new total", () => {
    const change = parsePricingChange(JSON.stringify({ subtotal: 7, discount_total: 1.4, food_total: 5.6, delivery_fee: 3.3 }));
    expect(change).toEqual({ subtotal: 7, discountTotal: 1.4, foodTotal: 5.6, deliveryFee: 3.3, total: 8.9, promotionLabel: null });
    expect(parsePricingChange("{")).toBeNull();
    expect(parsePricingChange(undefined)).toBeNull();
  });

  it("words the confirm dialog with the new total and the deal", () => {
    const prompt = pricingChangedPrompt({ subtotal: 7, discountTotal: 1.4, foodTotal: 5.6, deliveryFee: 3.3, total: 8.9, promotionLabel: null });
    expect(prompt).toContain("New total: $8.90");
    expect(prompt).toContain("Deal: -$1.40");
    expect(pricingChangedPrompt({ subtotal: 7, discountTotal: 0, foodTotal: 7, deliveryFee: 3.3, total: 10.3, promotionLabel: null })).not.toContain("Deal");
  });
});

describe("quoteOrderPricing (cart preview)", () => {
  const rpc = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  });

  it("asks quote_order_pricing with item ids and quantities only", async () => {
    rpc.mockResolvedValue({ data: { subtotal: 4, discount_total: 1, food_total: 3, promotion_label: "Kopi deal" }, error: null });
    const items = [{ menuItemId: "m1", quantity: 2, price: 0.01 }];
    await expect(quoteOrderPricing("k1", items as never)).resolves.toEqual({ subtotal: 4, discountTotal: 1, foodTotal: 3, promotionLabel: "Kopi deal" });
    expect(rpc).toHaveBeenCalledWith("quote_order_pricing", { p_kitchen_id: "k1", p_items: [{ menu_item_id: "m1", quantity: 2 }] });
  });

  it("is null when the function doesn't exist yet, so the cart shows no Deal line", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(quoteOrderPricing("k1", [{ menuItemId: "m1", quantity: 1 }])).resolves.toBeNull();
  });

  it("doesn't call the database for an empty cart", async () => {
    await expect(quoteOrderPricing("k1", [])).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
