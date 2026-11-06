import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Marketplace } from "@/components/Marketplace";
import { MerchantCard } from "@/components/MerchantCard";
import { RegionTag } from "@/components/RegionTag";
import { findCustomerRegion, findNearbyKitchenIds } from "@/lib/home-actions";
import { REGION_COLOURS } from "@/lib/regions";
import type { Merchant } from "@/lib/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/home-actions", () => ({ findNearbyKitchenIds: vi.fn(), findCustomerRegion: vi.fn() }));
vi.mock("@/lib/cart-context", () => ({ useCart: () => ({ itemCount: 0, subtotal: 0 }) }));
vi.mock("@/components/TopBar", () => ({ TopBar: () => null }));
vi.mock("@/components/BottomNav", () => ({ BottomNav: () => null }));

function kitchen(id: string, overrides: Partial<Merchant> = {}): Merchant {
  return {
    id, name: `Kitchen ${id}`, category: "hawker", cuisine: "Chinese", area: null, blurb: "", rating: 0, ratingCount: 0, etaMinutes: 30, distanceKm: null,
    latitude: 1.3404, longitude: 103.8501, priceFrom: 5, heroImage: "/categories/hawkers.jpg", avatarImage: "/categories/hawkers.jpg", cuisineType: "chinese",
    menuHighlights: [], isNew: false, liveSince: null, ...overrides,
  };
}

// Like the live test data: 3 east and 1 south, plus one kitchen with no region yet.
const MERCHANTS = [
  kitchen("e1", { region: "east" }),
  kitchen("s1", { region: "south" }),
  kitchen("none", { region: null }),
  kitchen("e2", { region: "east" }),
  kitchen("e3", { region: "east" }),
];

const regionChips = () => screen.queryByRole("tablist", { name: "Region" });
const allCooks = () => screen.getByRole("heading", { name: "All Cooks & Stalls" }).closest("section")!;
const names = (el: HTMLElement) => within(el).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

beforeEach(() => {
  vi.mocked(findNearbyKitchenIds).mockReset().mockResolvedValue({ source: "none", nearbyIds: [] });
  vi.mocked(findCustomerRegion).mockReset().mockResolvedValue(null);
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {}
});
afterEach(() => cleanup());

describe("RegionTag", () => {
  it("shows the region word in its colour, and reads 'Region: East'", () => {
    render(<RegionTag region="east" />);
    const tag = screen.getByTestId("region-tag");
    expect(tag).toHaveTextContent("Region: East");
    expect(tag.textContent).toContain("East"); // the word, never colour alone
    expect(tag).toHaveStyle({ color: REGION_COLOURS.east.text, background: REGION_COLOURS.east.background });
  });

  it("renders nothing without a region", () => {
    const { container } = render(<><RegionTag region={null} /><RegionTag region={undefined} /></>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MerchantCard region tag", () => {
  it("is on grid and list cards when the kitchen has a region", () => {
    render(<><MerchantCard merchant={kitchen("g", { region: "north" })} /><MerchantCard merchant={kitchen("l", { region: "west" })} variant="list" /></>);
    expect(screen.getAllByTestId("region-tag").map((t) => t.dataset.region)).toEqual(["north", "west"]);
  });

  it("is absent when the region is unknown", () => {
    render(<><MerchantCard merchant={kitchen("g")} /><MerchantCard merchant={kitchen("l", { region: null })} variant="list" /></>);
    expect(screen.queryByTestId("region-tag")).toBeNull();
  });
});

describe("Marketplace — region chips", () => {
  it("hides the chips (and never asks for the customer's region) until some kitchen has a region", async () => {
    render(<Marketplace merchants={[kitchen("a"), kitchen("b", { region: null })]} />);
    expect(regionChips()).toBeNull();
    await waitFor(() => expect(findNearbyKitchenIds).toHaveBeenCalled());
    expect(findCustomerRegion).not.toHaveBeenCalled();
  });

  it("shows All / North / South / East / West once a kitchen has a region, with All picked", () => {
    render(<Marketplace merchants={MERCHANTS} />);
    const chips = within(regionChips()!).getAllByRole("tab");
    expect(chips.map((c) => c.textContent)).toEqual(["All", "North", "South", "East", "West"]);
    expect(within(regionChips()!).getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  });

  it("filters the kitchens to the picked region", () => {
    render(<Marketplace merchants={MERCHANTS} />);
    fireEvent.click(within(regionChips()!).getByRole("tab", { name: "East" }));
    const section = screen.getByRole("heading", { name: "Kitchens in East" }).closest("section")!;
    expect(names(section)).toEqual(["Kitchen e1", "Kitchen e2", "Kitchen e3"]);
    expect(within(section).getAllByTestId("region-tag").every((t) => t.dataset.region === "east")).toBe(true);
  });

  it("combines the region with search, category and cuisine", () => {
    render(<Marketplace merchants={[...MERCHANTS, kitchen("e-bakery", { region: "east", category: "bakery" })]} />);
    fireEvent.click(within(regionChips()!).getByRole("tab", { name: "East" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "e2" } });
    expect(names(screen.getByRole("heading", { name: 'Results for "e2"' }).closest("section")!)).toEqual(["Kitchen e2"]);
  });

  it("explains an empty region, offers All, and still lists the other regions' kitchens", () => {
    render(<Marketplace merchants={MERCHANTS} />);
    fireEvent.click(within(regionChips()!).getByRole("tab", { name: "North" }));
    expect(screen.getByRole("status")).toHaveTextContent("No kitchens in North yet");
    expect(screen.getByRole("status")).toHaveTextContent("No cook or stall in North is on Kopi Boy yet.");
    const others = screen.getByRole("heading", { name: "Kitchens in other regions" }).closest("section")!;
    expect(names(others)).toHaveLength(MERCHANTS.length);

    fireEvent.click(screen.getByRole("button", { name: "Show all regions" }));
    expect(within(regionChips()!).getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "All Cooks & Stalls" })).toBeInTheDocument();
  });

  it("says when the other filters are why a region is empty", () => {
    render(<Marketplace merchants={MERCHANTS} />);
    fireEvent.click(within(regionChips()!).getByRole("tab", { name: "South" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "e1" } });
    expect(screen.getByRole("status")).toHaveTextContent("No kitchens in South match your filters");
    expect(names(screen.getByRole("heading", { name: "Kitchens in other regions" }).closest("section")!)).toEqual(["Kitchen e1"]);
    expect(screen.getByRole("button", { name: "Show all regions" })).toBeInTheDocument();
  });
});

describe("Marketplace — default order: nearby, own region, other regions, no region", () => {
  it("without a customer region: grouped North/South/East/West, no region last", async () => {
    render(<Marketplace merchants={MERCHANTS} />);
    await waitFor(() => expect(findCustomerRegion).toHaveBeenCalled());
    expect(names(allCooks())).toEqual(["Kitchen s1", "Kitchen e1", "Kitchen e2", "Kitchen e3", "Kitchen none"]);
  });

  it("puts nearby kitchens first, then the customer's own region (from the remembered postal code)", async () => {
    localStorage.setItem("kb-delivery-postal-code", "460123");
    vi.mocked(findNearbyKitchenIds).mockResolvedValue({ source: "postal-code", nearbyIds: ["none"] });
    vi.mocked(findCustomerRegion).mockResolvedValue("east");
    render(<Marketplace merchants={MERCHANTS} />);
    await waitFor(() => expect(names(allCooks())).toEqual(["Kitchen none", "Kitchen e1", "Kitchen e2", "Kitchen e3", "Kitchen s1"]));
    expect(findCustomerRegion).toHaveBeenCalledWith("460123");
  });

  it("with nothing nearby, says so and still lists every kitchen, own region first", async () => {
    vi.mocked(findNearbyKitchenIds).mockResolvedValue({ source: "saved-address", nearbyIds: [] });
    vi.mocked(findCustomerRegion).mockResolvedValue("south");
    render(<Marketplace merchants={MERCHANTS} />);
    expect(await screen.findByText("No kitchens within 8 km yet. Showing South first, then other regions.")).toBeInTheDocument();
    expect(names(allCooks())).toEqual(["Kitchen s1", "Kitchen e1", "Kitchen e2", "Kitchen e3", "Kitchen none"]);
  });

  it("keeps blocked kitchens last", async () => {
    render(<Marketplace merchants={[kitchen("blocked", { region: "north", isBlocked: true }), ...MERCHANTS]} />);
    await waitFor(() => expect(findCustomerRegion).toHaveBeenCalled());
    expect(names(allCooks()).at(-1)).toBe("Kitchen blocked");
  });

  it("asks for the customer's region once per session and postal code", async () => {
    localStorage.setItem("kb-delivery-postal-code", "460123");
    vi.mocked(findCustomerRegion).mockResolvedValue("east");
    const first = render(<Marketplace merchants={MERCHANTS} />);
    await waitFor(() => expect(findCustomerRegion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sessionStorage.getItem("kb-home-region")).toContain("east"));
    first.unmount();
    render(<Marketplace merchants={MERCHANTS} />);
    expect(names(allCooks())[0]).toBe("Kitchen e1");
    expect(findCustomerRegion).toHaveBeenCalledTimes(1);
  });
});
