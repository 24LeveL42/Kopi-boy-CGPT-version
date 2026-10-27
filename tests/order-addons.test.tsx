import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import OrderConfirmationPage, { type OrderRow } from "@/app/orders/[id]/page";

/** The customer's order page shows each line's add-ons and prices it as (dish + add-ons) × quantity. */

const db = vi.hoisted(() => ({
  order: null as unknown,
  /** Answers for order_items, in order: the add-ons select, then the plain fallback. */
  items: [] as { data: unknown; error: unknown }[],
  itemSelects: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "customer-1" } } }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    from(table: string) {
      const result = () => {
        if (table === "orders") return { data: db.order };
        if (table === "kitchens") return { data: { business_name: "Aunty May", paynow_type: null, paynow_value: null } };
        if (table === "order_items") return db.items.shift() ?? { data: null, error: { message: "unexpected" } };
        return { data: table === "delivery_requests" ? [] : null };
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["eq", "order", "limit"]) builder[m] = () => builder;
      builder.select = (cols: string) => {
        if (table === "order_items") db.itemSelects.push(cols);
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(result());
      builder.returns = () => Promise.resolve(result());
      builder.then = (resolve: (v: unknown) => void) => resolve({ count: 0, data: null, error: null });
      return builder;
    },
  }),
}));
vi.mock("@/components/OrderRealtimeRefresher", () => ({ OrderRealtimeRefresher: () => null }));
vi.mock("@/components/RiderLocationMap", () => ({ RiderLocationMap: () => null }));
vi.mock("@/components/CancelOrderButton", () => ({ CancelOrderButton: () => null }));
vi.mock("@/components/PaymentProofCard", () => ({ PaymentProofCard: () => null }));
vi.mock("@/components/OrderChat", () => ({ OrderChat: () => null }));
vi.mock("@/components/SupportChat", () => ({ SupportChatToggle: () => null }));
vi.mock("@/components/PushNotifications", () => ({ PushPrompt: () => null }));
vi.mock("@/components/RateOrder", () => ({ RateOrder: () => null, OrderRating: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order-1",
    kitchen_id: "kitchen-1",
    subtotal: 22.1,
    order_status: "accepted",
    payment_status: "unpaid",
    preparation_status: "cooking",
    created_at: "2026-01-01T00:00:00.000Z",
    decided_at: "2026-01-01T00:05:00.000Z",
    ready_at: null,
    ...overrides,
  };
}

async function renderPage() {
  const page = await OrderConfirmationPage({ params: Promise.resolve({ id: "order-1" }), searchParams: Promise.resolve({}) });
  return render(page);
}

beforeEach(() => {
  db.order = order();
  db.items = [];
  db.itemSelects = [];
});
afterEach(cleanup);

describe("Order page — add-ons", () => {
  it("lists each line's picks and charges (price + options_price) × quantity", async () => {
    db.items = [
      {
        data: [
          {
            id: "i1",
            name: "Laksa",
            price: 6.5,
            quantity: 2,
            options_price: "0.80",
            order_item_options: [
              { group_name: "Extras", name: "Extra egg", price: "0.80", sort_order: 1 },
              { group_name: "Spice level", name: "Hot", price: "0.00", sort_order: 0 },
            ],
          },
          { id: "i2", name: "Kopi", price: 2, quantity: 3, options_price: 0, order_item_options: [] },
        ],
        error: null,
      },
    ];
    await renderPage();
    expect(db.itemSelects[0]).toContain("order_item_options(");
    const [laksa, kopi] = screen.getAllByTestId("order-line");
    expect(within(laksa).getByTestId("order-line-options")).toHaveTextContent("Hot · Extra egg (+$0.80)");
    expect(laksa).toHaveTextContent("$14.60");
    expect(within(kopi).queryByTestId("order-line-options")).toBeNull();
    expect(kopi).toHaveTextContent("$6.00");
  });

  it("an order without add-ons looks as before", async () => {
    db.order = order({ subtotal: 6 });
    db.items = [{ data: [{ id: "i2", name: "Kopi", price: 2, quantity: 3, options_price: 0, order_item_options: [] }], error: null }];
    await renderPage();
    const [kopi] = screen.getAllByTestId("order-line");
    expect(kopi).toHaveTextContent("3× Kopi");
    expect(kopi).toHaveTextContent("$6.00");
    expect(screen.queryByTestId("order-line-options")).toBeNull();
  });

  it("falls back to the plain select if the add-ons query fails, still listing every line", async () => {
    db.order = order({ subtotal: 6 });
    db.items = [
      { data: null, error: { code: "42703", message: "column order_items.options_price does not exist" } },
      { data: [{ id: "i2", name: "Kopi", price: 2, quantity: 3 }], error: null },
    ];
    await renderPage();
    expect(db.itemSelects).toEqual([expect.stringContaining("options_price"), "id, name, price, quantity"]);
    expect(screen.getByTestId("order-line")).toHaveTextContent("$6.00");
  });
});
