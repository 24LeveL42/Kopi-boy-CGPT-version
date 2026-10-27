import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CartProvider, useCart } from "@/lib/cart-context";
import { CartView } from "@/components/CartView";
import { quoteDelivery } from "@/lib/delivery-actions";
import { placeOrder } from "@/lib/order-actions";
import { quoteOrderPricing } from "@/lib/pricing-actions";

/** Cart and checkout with add-on lines (stage A2), and carts saved before add-ons existed. */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/cart" }));
vi.mock("@/lib/order-actions", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/pricing-actions", () => ({ quoteOrderPricing: vi.fn() }));
vi.mock("@/lib/delivery-actions", () => ({ quoteDelivery: vi.fn() }));
vi.mock("@/lib/kitchen-actions", () => ({ isKitchenBlocked: vi.fn(async () => false) }));

const ADDRESS = "123 LORONG 1 TOA PAYOH SINGAPORE 310123";
const HOT = "00000000-0000-4000-8000-000000000103";
const MILD = "00000000-0000-4000-8000-000000000104";
const EGG = "00000000-0000-4000-8000-000000000105";
const hot = { id: HOT, groupName: "Spice level", name: "Hot", price: 0 };
const mild = { id: MILD, groupName: "Spice level", name: "Mild", price: 0 };
const egg = { id: EGG, groupName: "Extras", name: "Extra egg", price: 0.8 };

/** Exactly what the app saved before add-ons: no `options` anywhere. */
const OLD_CART = {
  kitchenId: "k1",
  kitchenName: "Aunty May",
  items: [
    { menuItemId: "m1", name: "Kopi", price: 2, photoUrl: null, quantity: 2 },
    { menuItemId: "m2", name: "Kaya Toast", price: 3, quantity: 1 },
  ],
};
const ADDON_CART = {
  kitchenId: "k1",
  kitchenName: "Aunty May",
  items: [
    { menuItemId: "m3", name: "Laksa", price: 6.5, quantity: 2, options: [hot, egg] },
    { menuItemId: "m3", name: "Laksa", price: 6.5, quantity: 1, options: [mild] },
    { menuItemId: "m1", name: "Kopi", price: 2, quantity: 1 },
  ],
};

/** Elsewhere in the app: swaps the Laksa line's pick from Hot to Mild. */
function SwapPick() {
  const { addItem, removeItem } = useCart();
  return (
    <button
      onClick={() => {
        addItem("k1", "Aunty May", { menuItemId: "m3", name: "Laksa", price: 6.5, options: [mild] });
        removeItem(`m3|${HOT}`);
      }}
    >
      swap pick
    </button>
  );
}

function renderCart(cart: unknown) {
  localStorage.setItem("kb-cart", JSON.stringify(cart));
  localStorage.setItem("kb-delivery-postal-code", "310123");
  render(
    <CartProvider>
      <SwapPick />
      <CartView isSignedIn />
    </CartProvider>
  );
}

async function goToCheckout() {
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Checkout/ }));
  await screen.findByText(`Found: ${ADDRESS}`);
}
const confirmButton = () => screen.getByRole("button", { name: /Confirm Order/ });

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.mocked(placeOrder).mockReset();
  vi.mocked(quoteOrderPricing).mockReset().mockResolvedValue(null);
  vi.mocked(quoteDelivery).mockReset().mockResolvedValue({ ok: true, address: ADDRESS, distanceKm: 3.04, fee: 3.3 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("A cart saved before add-ons", () => {
  it("loads, its steppers work, and it checks out with exactly the old items", async () => {
    renderCart(OLD_CART);
    fireEvent.click(await screen.findByRole("button", { name: "Increase Kaya Toast quantity" }));
    expect(screen.queryByTestId("cart-line-options")).toBeNull();
    await waitFor(() =>
      expect(quoteOrderPricing).toHaveBeenLastCalledWith("k1", [
        { menuItemId: "m1", quantity: 2 },
        { menuItemId: "m2", quantity: 2 },
      ])
    );
    await goToCheckout();
    expect(confirmButton()).toHaveTextContent("$13.30");

    vi.mocked(placeOrder).mockResolvedValue({ ok: true, orderId: "order-1" });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-1"));
    expect(vi.mocked(placeOrder).mock.calls[0][1]).toEqual([
      { menuItemId: "m1", quantity: 2 },
      { menuItemId: "m2", quantity: 2 },
    ]);
  });

  it("never crashes on junk in storage", async () => {
    localStorage.setItem("kb-cart", "{not json");
    render(
      <CartProvider>
        <CartView isSignedIn />
      </CartProvider>
    );
    expect(await screen.findByRole("heading", { name: "Your cart is waiting" })).toBeInTheDocument();
    cleanup();
    renderCart({ kitchenId: "k1", kitchenName: "Aunty May", items: [{ menuItemId: "m1", name: "Kopi", price: 2, quantity: 1, options: "hot" }, OLD_CART.items[1]] });
    expect(await screen.findByText("Kaya Toast")).toBeInTheDocument();
    expect(screen.queryByText("Kopi")).toBeNull();
  });
});

describe("Cart lines with add-ons", () => {
  it("shows each line's picks and its per-unit price, the same dish as separate lines", async () => {
    renderCart(ADDON_CART);
    const lines = await screen.findAllByTestId("cart-line");
    expect(lines).toHaveLength(3);
    expect(within(lines[0]).getByTestId("cart-line-options")).toHaveTextContent("Hot · Extra egg (+$0.80)");
    expect(lines[0]).toHaveTextContent("$7.30 each");
    expect(within(lines[1]).getByTestId("cart-line-options")).toHaveTextContent("Mild");
    expect(within(lines[2]).queryByTestId("cart-line-options")).toBeNull();
  });

  it("changes one line without touching the other line of the same dish", async () => {
    renderCart(ADDON_CART);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Laksa (Mild) from cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Laksa (Hot · Extra egg (+$0.80)) quantity" }));
    const items = JSON.parse(localStorage.getItem("kb-cart")!).items;
    expect(items.map((i: { name: string; quantity: number }) => [i.name, i.quantity])).toEqual([
      ["Laksa", 3],
      ["Kopi", 1],
    ]);
  });

  it("asks the server with the picks and shows its totals, not the cart's own", async () => {
    vi.mocked(quoteOrderPricing).mockResolvedValue({ subtotal: 18.4, discountTotal: 0, foodTotal: 18.4, promotionLabel: null, optionsSubtotal: 1.6 });
    renderCart(ADDON_CART);
    await waitFor(() =>
      expect(quoteOrderPricing).toHaveBeenCalledWith("k1", [
        { menuItemId: "m3", quantity: 2, optionIds: [HOT, EGG] },
        { menuItemId: "m3", quantity: 1, optionIds: [MILD] },
        { menuItemId: "m1", quantity: 1 },
      ])
    );
    // The cart's snapshot would say 7.30×2 + 6.50 + 2 = 23.10; the server says 18.40.
    expect(await screen.findByText("$18.40")).toBeInTheDocument();
    await goToCheckout();
    expect(confirmButton()).toHaveTextContent("$21.70");

    vi.mocked(placeOrder).mockResolvedValue({ ok: true, orderId: "order-2" });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-2"));
    const [, items, , opts] = vi.mocked(placeOrder).mock.calls[0];
    expect(items).toEqual([
      { menuItemId: "m3", quantity: 2, optionIds: [HOT, EGG] },
      { menuItemId: "m3", quantity: 1, optionIds: [MILD] },
      { menuItemId: "m1", quantity: 1 },
    ]);
    expect(opts?.expected).toEqual({ foodTotal: 18.4, deliveryFee: 3.3 });
  });

  it("holds checkout when the server refuses an add-on, until the line is removed", async () => {
    vi.mocked(quoteOrderPricing).mockImplementation(async (_k, items) =>
      items.some((i) => i.optionIds?.includes(MILD)) ? { addOnProblem: "One of the add-ons you picked has just sold out. Please check your choices." } : null
    );
    renderCart(ADDON_CART);
    expect(await screen.findByTestId("addon-problem")).toHaveTextContent("has just sold out");
    expect(screen.getByRole("button", { name: /Proceed to Checkout/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove Laksa (Mild) from cart" }));
    await waitFor(() => expect(screen.queryByTestId("addon-problem")).toBeNull());
    expect(screen.getByRole("button", { name: /Proceed to Checkout/ })).toBeEnabled();
  });

  it("notes that minimum spend counts dishes only, on a min_spend deal", async () => {
    vi.mocked(quoteOrderPricing).mockResolvedValue({ subtotal: 23.1, discountTotal: 3, foodTotal: 20.1, promotionLabel: "$3 off", minSpendDeal: true });
    renderCart(ADDON_CART);
    expect(await screen.findByTestId("min-spend-note")).toHaveTextContent("Minimum spend counts dishes only, not add-ons.");
  });

  it("has no min-spend note for other deals", async () => {
    vi.mocked(quoteOrderPricing).mockResolvedValue({ subtotal: 23.1, discountTotal: 3, foodTotal: 20.1, promotionLabel: "10% off" });
    renderCart(ADDON_CART);
    await screen.findByTestId("cart-deal");
    expect(screen.queryByTestId("min-spend-note")).toBeNull();
  });
});

describe("Checkout attempt id", () => {
  const LINE = { menuItemId: "m3", name: "Laksa", price: 6.5, quantity: 1, options: [hot] };

  it("is reused on a retry, and new once the picks change", async () => {
    vi.mocked(placeOrder).mockResolvedValue({ ok: false, message: "Something went wrong — please try again." });
    renderCart({ kitchenId: "k1", kitchenName: "Aunty May", items: [LINE] });
    await goToCheckout();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(2));

    // Same dish, different pick.
    act(() => fireEvent.click(screen.getByText("swap pick")));
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(3));

    const calls = vi.mocked(placeOrder).mock.calls;
    expect(calls[2][1]).toEqual([{ menuItemId: "m3", quantity: 1, optionIds: [MILD] }]);
    const ids = calls.map((c) => c[3]?.requestId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });
});
