import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CartProvider, useCart } from "@/lib/cart-context";
import { CartButton } from "@/components/CartButton";
import { CartView } from "@/components/CartView";
import { complaintPhotoPath, normalizeComplaintBody, validateComplaintPhoto } from "@/lib/complaints";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/order-actions", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/use-customer-location", () => ({
  useCustomerLocation: () => ({ coords: null, status: "idle", requestLocation: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
  }),
}));

const CART = {
  kitchenId: "k1",
  kitchenName: "Aunty May",
  items: [
    { menuItemId: "m1", name: "Kopi", price: 2, quantity: 3 },
    { menuItemId: "m2", name: "Kaya Toast", price: 3, quantity: 1 },
  ],
};

function renderWithCart(ui: React.ReactNode) {
  localStorage.setItem("kb-cart", JSON.stringify(CART));
  return render(<CartProvider>{ui}</CartProvider>);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CartButton (universal header)", () => {
  it("shows the total item count as a badge", async () => {
    renderWithCart(<CartButton />);
    expect(await screen.findByTestId("cart-badge")).toHaveTextContent("4");
    expect(screen.getByRole("link", { name: "Cart, 4 items" })).toHaveAttribute("href", "/cart");
  });

  it("still links to the cart with no badge when empty", () => {
    render(
      <CartProvider>
        <CartButton />
      </CartProvider>
    );
    expect(screen.getByRole("link", { name: "Cart" })).toHaveAttribute("href", "/cart");
    expect(screen.queryByTestId("cart-badge")).not.toBeInTheDocument();
  });

  it("updates live as items are removed elsewhere in the app", async () => {
    function RemoveKopi() {
      const { removeItem } = useCart();
      return <button onClick={() => removeItem("m1")}>remove kopi</button>;
    }
    renderWithCart(
      <>
        <CartButton />
        <RemoveKopi />
      </>
    );
    expect(await screen.findByTestId("cart-badge")).toHaveTextContent("4");
    act(() => fireEvent.click(screen.getByText("remove kopi")));
    expect(screen.getByTestId("cart-badge")).toHaveTextContent("1");
  });
});

describe("CartView remove + clear all", () => {
  it("removes a whole line in one tap, whatever its quantity", async () => {
    renderWithCart(<CartView isSignedIn />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Kopi from cart" }));
    expect(screen.queryByText("Kopi")).not.toBeInTheDocument();
    expect(screen.getByText("Kaya Toast")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("kb-cart")!).items).toHaveLength(1);
  });

  it("removing the last line empties the cart", async () => {
    renderWithCart(<CartView isSignedIn />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Kopi from cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Kaya Toast from cart" }));
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("quantity stepper still works independently of remove", async () => {
    renderWithCart(<CartView isSignedIn />);
    fireEvent.click(await screen.findByRole("button", { name: "Decrease Kopi quantity" }));
    expect(JSON.parse(localStorage.getItem("kb-cart")!).items[0].quantity).toBe(2);
  });

  it("Clear all empties the cart after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithCart(<CartView isSignedIn />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
    expect(localStorage.getItem("kb-cart")).toBeNull();
  });

  it("Clear all does nothing if the customer backs out", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithCart(<CartView isSignedIn />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    expect(screen.getByText("Kopi")).toBeInTheDocument();
  });
});

describe("complaints helpers", () => {
  it("builds <order>/<user>/<id>.<ext> keys", () => {
    expect(complaintPhotoPath("o", "u", "IMG_1.JPEG", "id")).toBe("o/u/id.jpeg");
    expect(complaintPhotoPath("o", "u", "no-extension", "id")).toBe("o/u/id.jpg");
  });

  it("validates type and size", () => {
    expect(validateComplaintPhoto({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateComplaintPhoto({ type: "image/gif", size: 1000 })).toMatch(/JPEG/);
    expect(validateComplaintPhoto({ type: "image/png", size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
  });

  it("needs text or a photo", () => {
    expect(normalizeComplaintBody("  ", false, 2000)).toBeNull();
    expect(normalizeComplaintBody("  ", true, 2000)).toBe("");
    expect(normalizeComplaintBody(" hi ", false, 2000)).toBe("hi");
    expect(normalizeComplaintBody("x".repeat(2001), true, 2000)).toBeNull();
  });
});
