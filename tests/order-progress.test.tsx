import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { OrderProgress, getLineFill, getStepState } from "@/components/OrderProgress";
import OrderConfirmationPage, { type OrderRow, type DeliveryRequestRow } from "@/app/orders/[id]/page";

const db = vi.hoisted(() => ({
  order: null as unknown,
  deliveries: [] as unknown[],
}));

// Minimal chainable stand-in for the supabase query builder the page uses.
// Every builder method returns itself; awaiting/`maybeSingle`/`returns` resolve
// to the table's canned data, so the page runs its real code path.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "customer-1" } } }),
    },
    // Rider lookup (covered in order-rider.test.tsx) — irrelevant to the bar.
    rpc: () => Promise.resolve({ data: [{ full_name: "Ahmad", photo_url: null }], error: null }),
    from(table: string) {
      const result = () => {
        if (table === "orders") return { data: db.order };
        if (table === "kitchens") return { data: { business_name: "Aunty May", paynow_type: null, paynow_value: null } };
        if (table === "messages") return { data: null };
        if (table === "order_items") return { data: [{ id: "i1", name: "Kopi", price: 2, quantity: 1 }] };
        return { data: db.deliveries };
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) builder[m] = () => builder;
      builder.maybeSingle = () => Promise.resolve(result());
      builder.returns = () => Promise.resolve(result());
      return builder;
    },
  }),
}));
vi.mock("@/components/OrderRealtimeRefresher", () => ({ OrderRealtimeRefresher: () => null }));
vi.mock("@/components/CancelOrderButton", () => ({ CancelOrderButton: () => null }));
vi.mock("@/components/OrderChat", () => ({ OrderChat: () => null }));
vi.mock("@/components/RateOrder", () => ({ RateOrder: () => null, OrderRating: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order-1",
    kitchen_id: "kitchen-1",
    subtotal: 2,
    order_status: "placed",
    payment_status: "unpaid",
    preparation_status: "not_started",
    created_at: "2026-01-01T00:00:00.000Z",
    decided_at: null,
    ready_at: null,
    ...overrides,
  };
}

const ACCEPTED = { order_status: "accepted", decided_at: "2026-01-01T00:05:00.000Z" } as const;
const riderAccepted: DeliveryRequestRow = { status: "accepted", accepted_at: "2026-01-01T00:25:00.000Z", completed_at: null };
const riderCompleted: DeliveryRequestRow = { status: "completed", accepted_at: "2026-01-01T00:25:00.000Z", completed_at: "2026-01-01T00:40:00.000Z" };

type StepStates = string[];

interface Scenario {
  name: string;
  order: OrderRow;
  deliveries: DeliveryRequestRow[];
  /** null = failure state instead of the bar */
  steps: StepStates | null;
  /** expected green fill width of the connecting line */
  fill?: string;
  message: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "placed",
    order: order(),
    deliveries: [],
    steps: ["upcoming", "upcoming", "upcoming", "upcoming"],
    fill: "0%",
    message: "Waiting for kitchen to accept",
  },
  {
    name: "accepted + not_started",
    order: order({ ...ACCEPTED }),
    deliveries: [],
    steps: ["done", "current", "upcoming", "upcoming"],
    fill: "33.33",
    message: "Order confirmed — cook is preparing your food",
  },
  {
    name: "accepted + preparing",
    order: order({ ...ACCEPTED, preparation_status: "preparing" }),
    deliveries: [],
    steps: ["done", "current", "upcoming", "upcoming"],
    fill: "33.33",
    message: "Order confirmed — cook is preparing your food",
  },
  {
    name: "ready (no rider yet)",
    order: order({ ...ACCEPTED, preparation_status: "ready", ready_at: "2026-01-01T00:20:00.000Z" }),
    deliveries: [{ status: "open", accepted_at: null, completed_at: null }],
    steps: ["done", "done", "upcoming", "upcoming"],
    fill: "50%",
    message: "Ready — looking for a rider",
  },
  {
    name: "rider released back to open",
    order: order({ ...ACCEPTED, preparation_status: "ready", ready_at: "2026-01-01T00:20:00.000Z" }),
    deliveries: [{ status: "release_requested", accepted_at: "2026-01-01T00:22:00.000Z", completed_at: null }],
    steps: ["done", "done", "upcoming", "upcoming"],
    fill: "50%",
    message: "Ready — looking for a rider",
  },
  {
    name: "rider assigned",
    order: order({ ...ACCEPTED, preparation_status: "ready", ready_at: "2026-01-01T00:20:00.000Z" }),
    deliveries: [riderAccepted],
    steps: ["done", "done", "current", "upcoming"],
    fill: "66.66",
    message: "A rider has been assigned and is on the way to pick up your order",
  },
  {
    name: "delivered",
    order: order({ ...ACCEPTED, preparation_status: "ready", ready_at: "2026-01-01T00:20:00.000Z" }),
    deliveries: [riderCompleted],
    steps: ["done", "done", "done", "done"],
    fill: "100%",
    message: "Delivered",
  },
  {
    name: "cancelled",
    order: order({ order_status: "cancelled", decided_at: "2026-01-01T00:02:00.000Z" }),
    deliveries: [],
    steps: null,
    message: "Order was cancelled",
  },
  {
    name: "rejected",
    order: order({ order_status: "rejected", decided_at: "2026-01-01T00:02:00.000Z" }),
    deliveries: [],
    steps: null,
    message: "Order was rejected",
  },
  {
    // A stale ready/delivery state must never leak a happy-path bar onto a dead order.
    name: "cancelled even if a delivery row lingers",
    order: order({ order_status: "cancelled", preparation_status: "ready", decided_at: "2026-01-01T00:02:00.000Z" }),
    deliveries: [riderAccepted],
    steps: null,
    message: "Order was cancelled",
  },
];

async function renderPage(s: Scenario) {
  db.order = s.order;
  db.deliveries = s.deliveries;
  const ui = await OrderConfirmationPage({ params: Promise.resolve({ id: s.order.id }) });
  return render(ui);
}

describe("/orders/[id] progress bar — every state, through the real page", () => {
  afterEach(cleanup);

  for (const s of SCENARIOS) {
    it(s.name, async () => {
      const { container } = await renderPage(s);
      const bar = container.querySelector("ol[aria-label='Order progress']");

      // The text status message is always kept.
      expect(within(container).getByText(s.message, { selector: "p" })).toBeInTheDocument();

      const icon = within(container).getByTestId("order-header-icon");
      const heading = within(container).getByRole("heading", { level: 1 });

      if (s.steps === null) {
        // Terminal failure: no happy-path bar, header reflects the final state.
        expect(bar).toBeNull();
        expect(heading).toHaveTextContent(s.order.order_status === "cancelled" ? "Order cancelled" : "Order declined");
        expect(icon).toHaveAttribute("data-failed", "true");
        expect(icon.style.background).toBe("var(--kb-danger)");
        expect(within(container).queryByText("Order placed!")).toBeNull();
        expect(within(container).queryByText(/has received your order/)).toBeNull();
        // Never tell a dead order's customer to pay once it's accepted.
        expect(within(container).queryByText(/Payment/)).toBeNull();
        expect(within(container).queryByText(/PayNow/)).toBeNull();
        return;
      }

      // Active or completed: green check + "Order placed!".
      expect(heading).toHaveTextContent("Order placed!");
      expect(within(container).getByText("Aunty May has received your order.")).toBeInTheDocument();
      expect(icon).toHaveAttribute("data-failed", "false");
      expect(within(container).getByText("Payment pending — pay the cook via PayNow once accepted")).toBeInTheDocument();
      expect(icon.style.background).toBe("var(--kb-green-deep)");
      expect(bar).not.toBeNull();
      const items = Array.from(bar!.querySelectorAll("li"));
      expect(items.map((li) => li.getAttribute("data-state"))).toEqual(s.steps);
      expect(items.map((li) => li.textContent?.split(",")[0])).toEqual([
        "Order accepted",
        "Preparing",
        "Rider on the way",
        "Delivered",
      ]);

      const width = (container.querySelector("[data-testid='progress-fill']") as HTMLElement).style.width;
      expect(width.startsWith(s.fill!.replace("%", ""))).toBe(true);

      // At most one step is flagged as the current one for assistive tech.
      expect(bar!.querySelectorAll("[aria-current='step']").length).toBe(s.steps.filter((x) => x === "current").length);
    });
  }

  it("shows the message's timestamp under the bar, and the bar comes first in the DOM", async () => {
    const s = SCENARIOS.find((x) => x.name === "rider assigned")!;
    const { container } = await renderPage(s);
    const bar = container.querySelector("ol[aria-label='Order progress']")!;
    const message = within(container).getByText(s.message, { selector: "p" });
    // bar precedes message
    expect(bar.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // timestamp element directly follows the message
    expect(message.nextElementSibling?.textContent).toMatch(/\d/);
  });
});

describe("bar fill follows the stage at every transition", () => {
  afterEach(cleanup);

  it("never moves backwards along the real happy path, and each step turns green exactly once", () => {
    // placed -> accepted/preparing -> ready -> rider assigned -> delivered
    const positions = [-1, 1, 1.5, 2, 3];
    let lastFill = -1;
    let lastGreen = -1;
    for (const p of positions) {
      const fill = getLineFill(p);
      const green = [0, 1, 2, 3].filter((i) => getStepState(i, p) !== "upcoming").length;
      expect(fill).toBeGreaterThanOrEqual(lastFill);
      expect(green).toBeGreaterThanOrEqual(lastGreen);
      lastFill = fill;
      lastGreen = green;
    }
  });

  it("line fill only reaches a green icon's centre, never past the last reached step", () => {
    expect(getLineFill(-1)).toBe(0);
    expect(getLineFill(1)).toBeCloseTo(1 / 3);
    expect(getLineFill(1.5)).toBeCloseTo(0.5);
    expect(getLineFill(2)).toBeCloseTo(2 / 3);
    expect(getLineFill(3)).toBe(1);
  });

  it("re-rendering with a new position updates the same DOM in place (so the fill animates)", () => {
    const { container, rerender } = render(<OrderProgress position={1} />);
    const fill = container.querySelector("[data-testid='progress-fill']");
    rerender(<OrderProgress position={2} />);
    expect(container.querySelector("[data-testid='progress-fill']")).toBe(fill);
    expect((fill as HTMLElement).style.width.startsWith("66.66")).toBe(true);
  });

  it("a cancel/reject after progress removes the bar entirely (the page header shows the failure)", () => {
    const { container, rerender } = render(<OrderProgress position={2} />);
    expect(container.querySelector("ol")).not.toBeNull();
    rerender(<OrderProgress position={null} />);
    expect(container.innerHTML).toBe("");
  });
});
