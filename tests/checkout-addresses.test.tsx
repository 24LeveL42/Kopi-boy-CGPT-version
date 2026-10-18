import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CartProvider } from "@/lib/cart-context";
import { CartView } from "@/components/CartView";
import { quoteDelivery } from "@/lib/delivery-actions";
import { placeOrder } from "@/lib/order-actions";
import type { SavedAddress } from "@/lib/addresses";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/cart" }));
vi.mock("@/lib/order-actions", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/delivery-actions", () => ({ quoteDelivery: vi.fn() }));
vi.mock("@/lib/kitchen-actions", () => ({ isKitchenBlocked: vi.fn(async () => false) }));

const CART = { kitchenId: "k1", kitchenName: "Aunty May", items: [{ menuItemId: "m1", name: "Kopi", price: 2, quantity: 1 }] };

function saved(overrides: Partial<SavedAddress>): SavedAddress {
  return { id: "a1", label: "Home", postal_code: "310123", address_line: "123 LORONG 1 TOA PAYOH", unit: null, notes: null, is_default: false, created_at: "2026-10-01T00:00:00Z", ...overrides };
}

const HOME = saved({ id: "home", label: "Home", postal_code: "310123", address_line: "123 LORONG 1 TOA PAYOH", unit: "#05-12", is_default: true });
const WORK = saved({ id: "work", label: "Work", postal_code: "018956", address_line: "10 BAYFRONT AVENUE", created_at: "2026-10-02T00:00:00Z" });

// Fee depends on the postal code, so switching address visibly re-quotes.
const QUOTES: Record<string, { address: string; distanceKm: number; fee: number }> = {
  "310123": { address: "123 LORONG 1 TOA PAYOH SINGAPORE 310123", distanceKm: 3.04, fee: 3.3 },
  "018956": { address: "10 BAYFRONT AVENUE SINGAPORE 018956", distanceKm: 8.46, fee: 6.0 },
  "560123": { address: "123 ANG MO KIO AVE 3 SINGAPORE 560123", distanceKm: 5.12, fee: 4.4 },
};

function renderCheckout(savedAddresses: SavedAddress[]) {
  localStorage.setItem("kb-cart", JSON.stringify(CART));
  render(
    <CartProvider>
      <CartView isSignedIn savedAddresses={savedAddresses} />
    </CartProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Checkout/ }));
}

const feeLine = () => screen.getByTestId("delivery-fee-estimate");

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.mocked(placeOrder).mockReset().mockResolvedValue({ ok: true, orderId: "order-9" });
  vi.mocked(quoteDelivery)
    .mockReset()
    .mockImplementation(async (_k, postal) => (QUOTES[postal] ? { ok: true, ...QUOTES[postal] } : { ok: false, reason: "not_found" }));
});
afterEach(() => cleanup());

describe("Checkout — Deliver to", () => {
  it("preselects the default saved address and quotes it", async () => {
    renderCheckout([HOME, WORK]);

    expect(screen.getByText("Deliver to")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Home: 123 LORONG 1 TOA PAYOH/ })).toBeChecked();
    await waitFor(() => expect(feeLine()).toHaveTextContent("Estimated delivery fee S$3.30 (about 3.0 km)"));
    expect(quoteDelivery).toHaveBeenCalledWith("k1", "310123", "normal");
  });

  it("re-quotes distance and fee when another saved address is picked", async () => {
    renderCheckout([HOME, WORK]);
    await waitFor(() => expect(feeLine()).toHaveTextContent("S$3.30"));

    fireEvent.click(screen.getByRole("radio", { name: /Work: 10 BAYFRONT AVENUE/ }));
    await waitFor(() => expect(feeLine()).toHaveTextContent("Estimated delivery fee S$6.00 (about 8.5 km)"));
    expect(quoteDelivery).toHaveBeenLastCalledWith("k1", "018956", "normal");
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toHaveTextContent("$8.00");
  });

  it("sends only the saved address id (and type) to placeOrder", async () => {
    renderCheckout([HOME, WORK]);
    await waitFor(() => expect(feeLine()).toHaveTextContent("S$3.30"));
    fireEvent.click(screen.getByRole("button", { name: /Express/ }));
    await waitFor(() => expect(quoteDelivery).toHaveBeenLastCalledWith("k1", "310123", "express"));

    fireEvent.click(screen.getByRole("button", { name: /Confirm Order/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/orders/order-9"));
    expect(placeOrder).toHaveBeenCalledWith("k1", [{ menuItemId: "m1", quantity: 1 }], { deliveryType: "express", addressId: "home" });
  });

  it("delivers to a different address: postal check, unit, notes, save off by default", async () => {
    renderCheckout([HOME]);
    await waitFor(() => expect(feeLine()).toHaveTextContent("S$3.30"));

    fireEvent.click(screen.getByRole("radio", { name: "Deliver to a different address" }));
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeDisabled();
    expect(screen.getByTestId("address-required")).toHaveTextContent("Enter the delivery postal code above, or pick a saved address.");
    expect(screen.getByRole("checkbox", { name: "Save this address" })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("Delivery postal code"), { target: { value: "560123" } });
    fireEvent.click(screen.getByRole("button", { name: "Check postal code" }));
    expect(await screen.findByText("Found: 123 ANG MO KIO AVE 3 SINGAPORE 560123")).toBeInTheDocument();
    expect(feeLine()).toHaveTextContent("Estimated delivery fee S$4.40 (about 5.1 km)");

    fireEvent.change(screen.getByLabelText(/^Unit/), { target: { value: "#10-01" } });
    fireEvent.change(screen.getByLabelText(/^Notes for the rider/), { target: { value: "Call when you arrive" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Order/ }));

    await waitFor(() => expect(placeOrder).toHaveBeenCalled());
    expect(vi.mocked(placeOrder).mock.calls[0][2]).toEqual({
      deliveryType: "normal",
      postalCode: "560123",
      unit: "#10-01",
      notes: "Call when you arrive",
      saveAddress: false,
      saveLabel: "Home",
    });
  });

  it("ticks Save this address by default when there are no saved addresses", () => {
    renderCheckout([]);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Save this address" })).toBeChecked();
  });

  it("disables Confirm Order with a clear message when there's no address at all", () => {
    renderCheckout([]);
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeDisabled();
    expect(screen.getByTestId("address-required")).toHaveTextContent("Add a delivery address to place your order");
    expect(quoteDelivery).not.toHaveBeenCalled();
  });

  it("explains that a 6th address won't be saved when the address book is full", () => {
    const five = Array.from({ length: 5 }, (_, i) => saved({ id: `a${i}`, label: `Place ${i}`, is_default: i === 0, created_at: `2026-10-0${i + 1}T00:00:00Z` }));
    renderCheckout(five);
    fireEvent.click(screen.getByRole("radio", { name: "Deliver to a different address" }));

    expect(screen.queryByRole("checkbox", { name: "Save this address" })).not.toBeInTheDocument();
    expect(screen.getByTestId("save-address-full")).toHaveTextContent("You've saved 5 addresses already, so this one won't be saved.");
  });
});
