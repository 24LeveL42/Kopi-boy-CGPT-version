import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MerchantCard } from "@/components/MerchantCard";
import { FavouritesView } from "@/components/FavouritesView";
import { CartView } from "@/components/CartView";
import { CartProvider } from "@/lib/cart-context";
import { sortAvailableFirst } from "@/lib/kitchen-availability";
import { isKitchenBlocked } from "@/lib/kitchen-actions";
import { quoteDelivery } from "@/lib/delivery-actions";
import MerchantPage from "@/app/merchant/[id]/page";
import type { Merchant } from "@/lib/types";

const db = vi.hoisted(() => ({
  kitchen: null as Record<string, unknown> | null,
  menuItems: [] as unknown[],
}));

// Just enough of the query builder for the merchant page: kitchens and the
// rating summary end in maybeSingle(), menu_items is awaited after order().
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) builder[m] = () => builder;
      builder.maybeSingle = async () => ({ data: table === "kitchens" ? db.kitchen : null, error: null });
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: db.menuItems, error: null });
      return builder;
    },
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/order-actions", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/pricing-actions", () => ({ quoteOrderPricing: vi.fn(async () => null) }));
vi.mock("@/lib/kitchen-actions", () => ({ isKitchenBlocked: vi.fn() }));
vi.mock("@/lib/delivery-actions", () => ({ quoteDelivery: vi.fn() }));

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "k-1",
    name: "Ah Seng Char Kway Teow",
    category: "hawker",
    cuisine: "Chinese",
    area: "Postal sector 31",
    blurb: "",
    rating: 4.5,
    ratingCount: 3,
    etaMinutes: 30,
    distanceKm: null,
    latitude: null,
    longitude: null,
    priceFrom: 5,
    heroImage: "/categories/hawkers.jpg",
    avatarImage: "/categories/hawkers.jpg",
    cuisineType: "chinese",
    menuHighlights: [{ name: "Char Kway Teow", price: 5 }],
    isNew: true,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  db.kitchen = null;
  db.menuItems = [];
  vi.mocked(isKitchenBlocked).mockReset().mockResolvedValue(false);
  vi.mocked(quoteDelivery).mockReset().mockResolvedValue({ ok: true, address: "1 TOA PAYOH", distanceKm: 3, fee: 3.3 });
});
afterEach(cleanup);

describe("MerchantCard — blocked kitchen", () => {
  for (const variant of ["grid", "list"] as const) {
    it(`fades a blocked kitchen's ${variant} card, badges it, and drops hover effects`, () => {
      const { container } = render(<MerchantCard merchant={merchant({ isBlocked: true })} variant={variant} />);
      const link = within(container).getByRole("link");
      expect(link).toHaveClass("is-unavailable");
      expect(link).not.toHaveClass("group"); // the image's group-hover zoom keys off this
      expect(within(container).getByTestId("unavailable-badge")).toHaveTextContent("Currently unavailable");
      // Still opens the kitchen page, where the banner explains it.
      expect(link).toHaveAttribute("href", "/merchant/k-1");
    });

    it(`leaves an available kitchen's ${variant} card alone`, () => {
      const { container } = render(<MerchantCard merchant={merchant()} variant={variant} />);
      const link = within(container).getByRole("link");
      expect(link).not.toHaveClass("is-unavailable");
      expect(link).toHaveClass("group");
      expect(within(container).queryByTestId("unavailable-badge")).toBeNull();
    });
  }

  it("never shows anything but 'Currently unavailable' — no reason", () => {
    const { container } = render(<MerchantCard merchant={merchant({ isBlocked: true })} />);
    expect(container).not.toHaveTextContent(/block|suspend|reason/i);
  });

  it("sorts blocked kitchens after available ones, keeping the order otherwise", () => {
    const list = [merchant({ id: "a", isBlocked: true }), merchant({ id: "b" }), merchant({ id: "c", isBlocked: true }), merchant({ id: "d" })];
    expect(sortAvailableFirst(list).map((m) => m.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("Favourites shows a blocked favourite faded and after the available ones", () => {
    localStorage.setItem("kb-favourites", JSON.stringify(["a", "b"]));
    render(<FavouritesView merchants={[merchant({ id: "a", name: "Blocked Kitchen", isBlocked: true }), merchant({ id: "b", name: "Open Kitchen" })]} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/merchant/b", "/merchant/a"]);
    expect(links[1]).toHaveClass("is-unavailable");
  });
});

describe("Merchant page — blocked kitchen", () => {
  const KITCHEN = { id: "k-1", business_name: "Aunty May", category: "hawker", cuisine_type: "chinese", description: null, hero_image: null };
  const ITEMS = [
    { id: "m1", name: "Kopi", price: 2, photo_url: null },
    { id: "m2", name: "Kaya Toast", price: 3, photo_url: null },
  ];

  async function renderPage() {
    const page = await MerchantPage({ params: Promise.resolve({ id: "k-1" }) });
    return render(<CartProvider>{page}</CartProvider>);
  }

  it("shows the grey banner and disables every Add to cart button", async () => {
    db.kitchen = { ...KITCHEN, is_blocked: true };
    db.menuItems = ITEMS;
    await renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("This kitchen is currently unavailable. You can't place orders right now.");
    const addButtons = screen.getAllByRole("button", { name: /^Add .* to cart$/ });
    expect(addButtons).toHaveLength(2);
    for (const b of addButtons) expect(b).toBeDisabled();

    // The item detail sheet's button is disabled too.
    fireEvent.click(screen.getByText("Kopi"));
    expect(screen.getByRole("button", { name: "Currently unavailable" })).toBeDisabled();

    fireEvent.click(addButtons[0]);
    expect(localStorage.getItem("kb-cart")).toBeNull();
  });

  it("has no banner and working Add buttons for an available kitchen", async () => {
    db.kitchen = { ...KITCHEN, is_blocked: false };
    db.menuItems = ITEMS;
    await renderPage();

    expect(screen.queryByText(/currently unavailable/i)).toBeNull();
    for (const b of screen.getAllByRole("button", { name: /^Add .* to cart$/ })) expect(b).toBeEnabled();
  });
});

describe("Cart + checkout — blocked kitchen", () => {
  const CART = { kitchenId: "k1", kitchenName: "Aunty May", items: [{ menuItemId: "m1", name: "Kopi", price: 2, quantity: 1 }] };

  function renderCart() {
    localStorage.setItem("kb-cart", JSON.stringify(CART));
    localStorage.setItem("kb-delivery-postal-code", "310123");
    render(
      <CartProvider>
        <CartView isSignedIn />
      </CartProvider>
    );
  }

  it("explains the kitchen is unavailable and disables Confirm Order", async () => {
    vi.mocked(isKitchenBlocked).mockResolvedValue(true);
    renderCart();

    expect(await screen.findByTestId("kitchen-unavailable")).toHaveTextContent("This kitchen is currently unavailable.");
    expect(isKitchenBlocked).toHaveBeenCalledWith("k1");

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Checkout/ }));
    await screen.findByText("Found: 1 TOA PAYOH");
    expect(screen.getByTestId("kitchen-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeDisabled();
  });

  it("shows no notice for an available kitchen", async () => {
    renderCart();
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Checkout/ }));
    await screen.findByText("Found: 1 TOA PAYOH");
    await waitFor(() => expect(isKitchenBlocked).toHaveBeenCalled());
    expect(screen.queryByTestId("kitchen-unavailable")).toBeNull();
    expect(screen.getByRole("button", { name: /Confirm Order/ })).toBeEnabled();
  });
});
