import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CartProvider } from "@/lib/cart-context";
import { CartView } from "@/components/CartView";
import { quoteDelivery } from "@/lib/delivery-actions";
import { placeOrder } from "@/lib/order-actions";
import { quoteOrderPricing } from "@/lib/pricing-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/cart" }));
vi.mock("@/lib/order-actions", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/pricing-actions", () => ({ quoteOrderPricing: vi.fn() }));
vi.mock("@/lib/delivery-actions", () => ({ quoteDelivery: vi.fn() }));
vi.mock("@/lib/kitchen-actions", () => ({ isKitchenBlocked: vi.fn(async () => false) }));

const CART = {
  kitchenId: "k1",
  kitchenName: "Aunty May",
  items: [{ menuItemId: "m1", name: "Kopi", price: 2, quantity: 1 }],
};
const ADDRESS = "123 LORONG 1 TOA PAYOH SINGAPORE 310123";
const DEAL = { subtotal: 2, discountTotal: 0.5, foodTotal: 1.5, promotionLabel: "25% off Kopi" };
const CHANGE = { subtotal: 2, discountTotal: 0, foodTotal: 2, promotionLabel: null, deliveryFee: 3.3, total: 5.3 };

function renderCart() {
  localStorage.setItem("kb-cart", JSON.stringify(CART));
  localStorage.setItem("kb-delivery-postal-code", "310123");
  render(
    <CartProvider>
      <CartView isSignedIn />
    </CartProvider>
  );
}

async function goToCheckout() {
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Checkout/ }));
  await screen.findByText(`Found: ${ADDRESS}`);
}

const confirmButton = () => screen.getByRole("button", { name: /Confirm Order/ });
const requestIds = () => vi.mocked(placeOrder).mock.calls.map((c) => c[3]?.requestId);

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.mocked(placeOrder).mockReset();
  vi.mocked(quoteOrderPricing).mockReset().mockResolvedValue(null);
  vi.mocked(quoteDelivery)
    .mockReset()
    .mockImplementation(async (_k, _p, type) => ({ ok: true, address: ADDRESS, distanceKm: 3.04, fee: type === "express" ? 4.5 : 3.3 }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Cart — Deal line", () => {
  it("looks exactly as before when there's no deal", async () => {
    renderCart();
    await waitFor(() => expect(quoteOrderPricing).toHaveBeenCalledWith("k1", [{ menuItemId: "m1", quantity: 1 }]));
    expect(screen.queryByTestId("cart-deal")).toBeNull();
    expect(screen.queryByText("Deal")).toBeNull();

    await goToCheckout();
    expect(screen.queryByTestId("checkout-deal")).toBeNull();
    expect(confirmButton()).toHaveTextContent("$5.30");
  });

  it("hides the Deal line when the preview says the discount is 0", async () => {
    vi.mocked(quoteOrderPricing).mockResolvedValue({ subtotal: 2, discountTotal: 0, foodTotal: 2, promotionLabel: null });
    renderCart();
    await goToCheckout();
    expect(screen.queryByTestId("checkout-deal")).toBeNull();
    expect(confirmButton()).toHaveTextContent("$5.30");
  });

  it("shows Deal -$x and takes it off the total, on the cart and at checkout", async () => {
    vi.mocked(quoteOrderPricing).mockResolvedValue(DEAL);
    renderCart();
    expect(await screen.findByTestId("cart-deal")).toHaveTextContent("Deal-$0.50");

    await goToCheckout();
    expect(screen.getByTestId("checkout-deal")).toHaveTextContent("Deal-$0.50");
    expect(confirmButton()).toHaveTextContent("$4.80");

    vi.mocked(placeOrder).mockResolvedValue({ ok: true, orderId: "order-9" });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-9"));
    // What the customer was shown is what place_order must match.
    expect(vi.mocked(placeOrder).mock.calls[0][3]?.expected).toEqual({ foodTotal: 1.5, deliveryFee: 3.3 });
  });
});

describe("Checkout — price changed before placing", () => {
  it("asks with the new total and places at that price, with the same request id, once confirmed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(placeOrder)
      .mockResolvedValueOnce({ ok: false, message: "The price of your order has changed. Please check the new total.", pricingChanged: CHANGE })
      .mockResolvedValueOnce({ ok: true, orderId: "order-9" });
    vi.mocked(quoteOrderPricing).mockResolvedValue(DEAL);
    renderCart();
    await screen.findByTestId("cart-deal");
    await goToCheckout();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-9"));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("New total: $5.30"));
    expect(placeOrder).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(placeOrder).mock.calls;
    expect(first[3]?.expected).toEqual({ foodTotal: 1.5, deliveryFee: 3.3 });
    expect(second[3]?.expected).toEqual({ foodTotal: 2, deliveryFee: 3.3 });
    expect(second[3]?.requestId).toBe(first[3]?.requestId);
  });

  it("places nothing and says why when the customer declines", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.mocked(placeOrder).mockResolvedValue({
      ok: false,
      message: "The price of your order has changed. Please check the new total.",
      pricingChanged: CHANGE,
    });
    renderCart();
    await goToCheckout();
    const previews = vi.mocked(quoteOrderPricing).mock.calls.length;

    fireEvent.click(confirmButton());
    expect(await screen.findByText("The price of your order has changed. Please check the new total.")).toBeInTheDocument();
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    // The cart re-asks for the price so the screen catches up.
    await waitFor(() => expect(vi.mocked(quoteOrderPricing).mock.calls.length).toBeGreaterThan(previews));
  });
});

describe("Checkout — request id", () => {
  it("reuses the id when the same attempt is retried, and starts a new one after a change", async () => {
    vi.mocked(placeOrder)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: false, message: "This kitchen isn't accepting orders right now." })
      .mockResolvedValueOnce({ ok: true, orderId: "order-9" });
    renderCart();
    await goToCheckout();

    fireEvent.click(confirmButton());
    expect(await screen.findByText("Something went wrong — please try again.")).toBeInTheDocument();
    fireEvent.click(confirmButton());
    expect(await screen.findByText("This kitchen isn't accepting orders right now.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Express/ }));
    await waitFor(() => expect(confirmButton()).toHaveTextContent("$6.50"));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-9"));

    const [a, b, c] = requestIds();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});
