import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CartProvider } from "@/lib/cart-context";
import MerchantPage from "@/app/merchant/[id]/page";

const db = vi.hoisted(() => ({
  regions: { data: [] as unknown[] | null, error: null as { code: string; message: string } | null },
  columns: [] as string[],
}));

// The merchant page's queries: kitchens and the rating summary end in
// maybeSingle(), menu_items is awaited after order(), add-on groups and the
// region read end in returns().
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => (table === "kitchens" && db.columns.push(columns), builder);
      for (const m of ["eq", "order", "in"]) builder[m] = () => builder;
      builder.maybeSingle = async () => ({
        data: table === "kitchens" ? { id: "k-1", business_name: "Aunty May", category: "hawker", cuisine_type: "chinese", description: null, hero_image: null, postal_sector: "46" } : null,
        error: null,
      });
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      builder.returns = async () => (table === "kitchens" ? db.regions : { data: [], error: null });
      return builder;
    },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/order-actions", () => ({ placeOrder: vi.fn() }));
vi.mock("@/lib/pricing-actions", () => ({ quoteOrderPricing: vi.fn(async () => null) }));
vi.mock("@/lib/kitchen-actions", () => ({ isKitchenBlocked: vi.fn(async () => false) }));
vi.mock("@/lib/delivery-actions", () => ({ quoteDelivery: vi.fn() }));

async function renderPage() {
  const page = await MerchantPage({ params: Promise.resolve({ id: "k-1" }) });
  return render(<CartProvider>{page}</CartProvider>);
}

afterEach(() => {
  cleanup();
  db.columns = [];
});

describe("Kitchen page — region tag", () => {
  it("shows the kitchen's region, read on its own as id and region", async () => {
    db.regions = { data: [{ id: "k-1", region: "east" }], error: null };
    await renderPage();
    expect(screen.getByTestId("region-tag")).toHaveTextContent("Region: East");
    expect(db.columns).toContain("id, region");
    expect(db.columns.every((c) => c === "id, region" || !c.split(", ").includes("region"))).toBe(true);
  });

  it("still shows the kitchen, without a tag, when the region read fails", async () => {
    db.regions = { data: null, error: { code: "42501", message: "permission denied" } };
    await renderPage();
    expect(screen.getByRole("heading", { name: "Aunty May" })).toBeInTheDocument();
    expect(screen.queryByTestId("region-tag")).toBeNull();
  });
});
