import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import OrdersPage from "@/app/orders/page";

type Call = [string, ...unknown[]];

const db = vi.hoisted(() => ({
  user: { id: "customer-1" } as { id: string } | null,
  rows: [] as unknown[],
  /** Result for queries that include the archive filter (null = use rows). */
  filteredError: null as { code: string; message: string } | null,
  queries: [] as Call[][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from(table: string) {
      const calls: Call[] = [["from", table]];
      db.queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push([m, ...args]);
          return builder;
        };
      }
      builder.returns = () => {
        const filtered = calls.some((c) => c[0] === "is");
        if (filtered && db.filteredError) return Promise.resolve({ data: null, error: db.filteredError });
        return Promise.resolve({ data: db.rows, error: null });
      };
      return builder;
    },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/orders" }));

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    kitchen_id: "kitchen-1",
    subtotal: 12.5,
    order_status: "placed",
    payment_status: "unpaid",
    preparation_status: "not_started",
    created_at: "2026-09-20T02:00:00.000Z",
    decided_at: null,
    ready_at: null,
    kitchens: { business_name: "Aunty May" },
    delivery_requests: [],
    ...overrides,
  };
}

async function renderPage() {
  return render(await OrdersPage());
}

beforeEach(() => {
  db.user = { id: "customer-1" };
  db.rows = [];
  db.filteredError = null;
  db.queries = [];
});
afterEach(cleanup);

describe("/orders — order history", () => {
  it("queries the customer's 10 newest NON-archived orders", async () => {
    await renderPage();
    expect(db.queries).toHaveLength(1);
    const calls = db.queries[0];
    expect(calls).toContainEqual(["from", "orders"]);
    expect(calls).toContainEqual(["eq", "customer_id", "customer-1"]);
    expect(calls).toContainEqual(["is", "customer_archived_at", null]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 10]);
  });

  it("lists each order with kitchen, total, SG time, status, and a link to its page", async () => {
    db.rows = [
      row({ id: "o2", order_status: "accepted", preparation_status: "ready", delivery_requests: [{ status: "completed", accepted_at: "t", completed_at: "t2" }] }),
      row({ id: "o1", order_status: "cancelled", kitchens: null }),
    ];
    await renderPage();
    const items = screen.getAllByTestId("order-history-row");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("href", "/orders/o2");
    expect(items[0]).toHaveTextContent("Aunty May");
    expect(items[0]).toHaveTextContent("$12.50");
    expect(items[0]).toHaveTextContent("Delivered");
    expect(items[0]).toHaveTextContent("20 Sept"); // 02:00Z = 10:00 SGT
    expect(items[0]).toHaveTextContent(/10:00/);
    expect(items[1]).toHaveAttribute("href", "/orders/o1");
    expect(items[1]).toHaveTextContent("Kitchen"); // kitchen offline -> RLS hides it -> fallback name
    expect(items[1]).toHaveTextContent("Order was cancelled");
  });

  it("falls back to the unfiltered query if the archive column doesn't exist yet", async () => {
    db.filteredError = { code: "42703", message: 'column orders.customer_archived_at does not exist' };
    db.rows = [row()];
    await renderPage();
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1].some((c) => c[0] === "is")).toBe(false);
    expect(db.queries[1]).toContainEqual(["limit", 10]);
    expect(screen.getAllByTestId("order-history-row")).toHaveLength(1);
  });

  it("shows an error, not an empty state, when loading fails for another reason", async () => {
    db.filteredError = { code: "500", message: "boom" };
    await renderPage();
    expect(screen.getByText(/Couldn't load your orders/)).toBeInTheDocument();
    expect(screen.queryByText("No orders yet.")).not.toBeInTheDocument();
  });

  it("shows an empty state with no orders", async () => {
    await renderPage();
    expect(screen.getByText("No orders yet.")).toBeInTheDocument();
  });

  it("asks a signed-out visitor to sign in, without querying orders", async () => {
    db.user = null;
    await renderPage();
    expect(screen.getByText("Sign in to see your orders.")).toBeInTheDocument();
    expect(db.queries).toHaveLength(0);
  });

  it("marks the Orders tab as current in the bottom nav", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /Orders/ })).toHaveAttribute("aria-current", "page");
  });
});
