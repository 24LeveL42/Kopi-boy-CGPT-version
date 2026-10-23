import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CartProvider } from "@/lib/cart-context";
import { CartView } from "@/components/CartView";
import { quoteDelivery } from "@/lib/delivery-actions";
import { placeOrder } from "@/lib/order-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/cart" }));
vi.mock("@/lib/order-actions", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/pricing-actions", () => ({ quoteOrderPricing: vi.fn(async () => null) }));
vi.mock("@/lib/delivery-actions", () => ({ quoteDelivery: vi.fn() }));
vi.mock("@/lib/kitchen-actions", () => ({ isKitchenBlocked: vi.fn(async () => false) }));

const CART = {
  kitchenId: "k1",
  kitchenName: "Aunty May",
  items: [{ menuItemId: "m1", name: "Kopi", price: 2, quantity: 1 }],
};

const ADDRESS = "123 LORONG 1 TOA PAYOH SINGAPORE 310123";

function renderCheckout({ postalCode }: { postalCode?: string } = {}) {
  localStorage.setItem("kb-cart", JSON.stringify(CART));
  if (postalCode) localStorage.setItem("kb-delivery-postal-code", postalCode);
  render(
    <CartProvider>
      <CartView isSignedIn />
    </CartProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Checkout/ }));
}

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.mocked(placeOrder).mockReset();
  vi.mocked(quoteDelivery).mockReset();
  vi.mocked(quoteDelivery).mockImplementation(async (_kitchenId, _postal, type) =>
    type === "express"
      ? { ok: true, address: ADDRESS, distanceKm: 3.04, fee: 4.5 }
      : { ok: true, address: ADDRESS, distanceKm: 3.04, fee: 3.3 }
  );
});
afterEach(() => cleanup());

describe("Checkout — postal-code delivery fee", () => {
  it("quotes the remembered postal code and shows the address, fee, distance and total", async () => {
    renderCheckout({ postalCode: "310123" });

    expect(await screen.findByText(`Found: ${ADDRESS}`)).toBeInTheDocument();
    expect(screen.getByTestId("delivery-fee-estimate")).toHaveTextContent("Estimated delivery fee S$3.30 (about 3.0 km)");
    expect(quoteDelivery).toHaveBeenCalledWith("k1", "310123", "normal");
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toHaveTextContent("$5.30");
  });

  it("re-quotes with Express when that option is picked", async () => {
    renderCheckout({ postalCode: "310123" });
    await screen.findByText(`Found: ${ADDRESS}`);

    fireEvent.click(screen.getByRole("button", { name: /Express/ }));
    await waitFor(() =>
      expect(screen.getByTestId("delivery-fee-estimate")).toHaveTextContent("Estimated delivery fee S$4.50 (about 3.0 km)")
    );
    expect(quoteDelivery).toHaveBeenLastCalledWith("k1", "310123", "express");
    expect(screen.getByRole("button", { name: /Express/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toHaveTextContent("$6.50");
  });

  it("checks a typed postal code, remembers it once found", async () => {
    renderCheckout();
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Delivery postal code"), { target: { value: "310123" } });
    fireEvent.click(screen.getByRole("button", { name: "Check postal code" }));

    expect(await screen.findByText(`Found: ${ADDRESS}`)).toBeInTheDocument();
    expect(localStorage.getItem("kb-delivery-postal-code")).toBe("310123");
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeEnabled();
  });

  it("asks for 6 digits instead of looking up a short code", () => {
    renderCheckout();
    fireEvent.change(screen.getByLabelText("Delivery postal code"), { target: { value: "3101" } });
    fireEvent.click(screen.getByRole("button", { name: "Check postal code" }));

    expect(screen.getByTestId("postal-status")).toHaveTextContent("Enter a 6-digit postal code.");
    expect(quoteDelivery).not.toHaveBeenCalled();
  });

  it("says when a postal code can't be found", async () => {
    vi.mocked(quoteDelivery).mockResolvedValue({ ok: false, reason: "not_found" });
    renderCheckout({ postalCode: "999999" });

    expect(await screen.findByText("We couldn't find that postal code. Please check it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeDisabled();
  });

  it("says when postal code lookup is unavailable", async () => {
    vi.mocked(quoteDelivery).mockResolvedValue({ ok: false, reason: "unavailable" });
    renderCheckout({ postalCode: "310123" });

    expect(
      await screen.findByText("Postal code lookup is temporarily unavailable. Please try again in a minute.")
    ).toBeInTheDocument();
  });

  it("doesn't re-quote or change the fee when the item count changes", async () => {
    localStorage.setItem("kb-cart", JSON.stringify(CART));
    localStorage.setItem("kb-delivery-postal-code", "310123");
    render(
      <CartProvider>
        <CartView isSignedIn />
      </CartProvider>
    );
    await waitFor(() => expect(screen.getByText("Delivery Fee").nextSibling).toHaveTextContent("$3.30"));

    fireEvent.click(screen.getByRole("button", { name: "Increase Kopi quantity" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Kopi quantity" }));

    expect(screen.getByText("Delivery Fee").nextSibling).toHaveTextContent("$3.30");
    expect(screen.getByRole("button", { name: /Proceed to Checkout/ })).toHaveTextContent("$9.30");
    expect(quoteDelivery).toHaveBeenCalledTimes(1);
  });

  it("sends only the postal code, type and typed details to placeOrder (no fee or coordinates), then opens the order", async () => {
    vi.mocked(placeOrder).mockResolvedValue({ ok: true, orderId: "order-9" });
    renderCheckout({ postalCode: "310123" });
    await screen.findByText(`Found: ${ADDRESS}`);

    fireEvent.click(screen.getByRole("button", { name: /Confirm Order/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-9"));
    // No saved addresses yet, so "Save this address" starts ticked.
    expect(placeOrder).toHaveBeenCalledWith("k1", [{ menuItemId: "m1", quantity: 1 }], {
      postalCode: "310123",
      deliveryType: "normal",
      scheduledFor: null,
      unit: "",
      notes: "",
      saveAddress: true,
      saveLabel: "Home",
    }, {
      // A fresh id for this attempt, and exactly the food total and fee shown.
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      expected: { foodTotal: 2, deliveryFee: 3.3 },
    });
  });

  it("shows placeOrder's message and stays put when the order can't be created", async () => {
    vi.mocked(placeOrder).mockResolvedValue({ ok: false, message: "This kitchen hasn't finished setting up its location yet." });
    renderCheckout({ postalCode: "310123" });
    await screen.findByText(`Found: ${ADDRESS}`);

    fireEvent.click(screen.getByRole("button", { name: /Confirm Order/ }));
    expect(await screen.findByText("This kitchen hasn't finished setting up its location yet.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Checkout — When", () => {
  it("defaults to As soon as possible and has no 'coming soon' schedule tile any more", async () => {
    renderCheckout({ postalCode: "310123" });
    await screen.findByText(`Found: ${ADDRESS}`);
    expect(screen.getByRole("button", { name: /As soon as possible/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delivery time")).not.toBeInTheDocument();
  });

  it("lists 30-minute slots at least 45 minutes ahead and sends the chosen one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T02:07:00.000Z")); // 10:07 SGT
    try {
      vi.mocked(placeOrder).mockResolvedValue({ ok: true, orderId: "order-9" });
      renderCheckout({ postalCode: "310123" });
      await screen.findByText(`Found: ${ADDRESS}`);

      fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
      const select = screen.getByLabelText("Delivery time") as HTMLSelectElement;
      // "Choose a time" first, then the first slot: 11:00 today.
      expect(select.options[1].value).toBe("2026-10-18T03:00:00.000Z");
      expect(select.options[1].textContent).toMatch(/^Today, 11:00/);
      // Confirm stays disabled until a time is picked.
      expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeDisabled();
      expect(screen.getByTestId("time-required")).toBeInTheDocument();

      fireEvent.change(select, { target: { value: "2026-10-18T09:30:00.000Z" } });
      fireEvent.click(screen.getByRole("button", { name: /Confirm Order/ }));
      await waitFor(() => expect(placeOrder).toHaveBeenCalled());
      expect(vi.mocked(placeOrder).mock.calls[0][2]).toMatchObject({ scheduledFor: "2026-10-18T09:30:00.000Z" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the order with a gentle note flag when Save this address failed", async () => {
    vi.mocked(placeOrder).mockResolvedValue({ ok: true, orderId: "order-9", addressSaved: false });
    renderCheckout({ postalCode: "310123" });
    await screen.findByText(`Found: ${ADDRESS}`);
    fireEvent.click(screen.getByRole("button", { name: /Confirm Order/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-9?address=not-saved"));
  });

  it("hints at a nearby postal code for new buildings", () => {
    renderCheckout();
    expect(screen.getByText("New building? Try a nearby postal code.")).toBeInTheDocument();
  });
});
