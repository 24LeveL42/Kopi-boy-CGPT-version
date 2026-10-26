import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Marketplace } from "@/components/Marketplace";
import { HomeCarousel } from "@/components/HomeCarousel";
import { MerchantCard } from "@/components/MerchantCard";
import { findNearbyKitchenIds } from "@/lib/home-actions";
import { BRAND_IMAGE_SLIDES, BRAND_ONLY, type HeroSlide } from "@/lib/hero-slides";
import type { DealsFeed, KitchenDeal } from "@/lib/deals";
import type { Merchant } from "@/lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push }) }));
vi.mock("@/lib/home-actions", () => ({ findNearbyKitchenIds: vi.fn() }));
vi.mock("@/lib/cart-context", () => ({ useCart: () => ({ itemCount: 0, subtotal: 0 }) }));
vi.mock("@/components/TopBar", () => ({ TopBar: () => null }));
vi.mock("@/components/BottomNav", () => ({ BottomNav: () => null }));

const RECENT = new Date(Date.now() - 2 * 86_400_000).toISOString();

function kitchen(id: string, overrides: Partial<Merchant> = {}): Merchant {
  return {
    id, name: `Kitchen ${id}`, category: "hawker", cuisine: "Chinese", area: null, blurb: "", rating: 0, ratingCount: 0, etaMinutes: 30, distanceKm: null,
    latitude: 1.3404, longitude: 103.8501, priceFrom: 5, heroImage: "/categories/hawkers.jpg", avatarImage: "/categories/hawkers.jpg", cuisineType: "chinese",
    menuHighlights: [], isNew: false, liveSince: null, ...overrides,
  };
}

function liveDeal(kitchenId: string, kind: KitchenDeal["kind"] = "percent_off"): KitchenDeal {
  return {
    id: `d-${kitchenId}-${kind}`, kitchenId, kind, title: "Weekday treat", percentOff: 10, amountOff: null, buyQty: null, getQty: null, itemName: "Laksa", minSpend: null,
    originalPrice: 8.5, dealPrice: 6.5, startsAt: null, endsAt: new Date(Date.now() + 3_600_000).toISOString(), remainingQty: null,
  };
}

// Seven established kitchens fill "Popular Near You" (top 6); "new-1" and "new-2" are new.
const established = Array.from({ length: 7 }, (_, i) => kitchen(`old-${i}`, { rating: 5 - i * 0.1, ratingCount: 3 }));
const MERCHANTS = [...established, kitchen("new-1", { isNew: true, liveSince: RECENT }), kitchen("new-2", { isNew: true, liveSince: RECENT, latitude: 1.45, longitude: 103.6 })];

beforeEach(() => {
  vi.mocked(findNearbyKitchenIds).mockResolvedValue({ source: "none", nearbyIds: [] });
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {}
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Marketplace — Phase A discovery (display only)", () => {
  it("keeps the brand hero and existing sections, and hides every deal surface while the deals source is missing", async () => {
    render(<Marketplace merchants={MERCHANTS} />);
    expect(screen.getByText(/Good food,/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Popular Near You" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "All Cooks & Stalls" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "New Kitchens Near You" });
    expect(screen.queryByText(/Today's Deals/)).toBeNull();
    expect(screen.queryByTestId("deal-badge")).toBeNull();
  });

  it("shows only genuinely new kitchens in New Kitchens Near You, newest first, none from Popular", async () => {
    render(<Marketplace merchants={MERCHANTS} />);
    const section = (await screen.findByRole("heading", { name: "New Kitchens Near You" })).closest("section")!;
    const names = within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(["Kitchen new-1", "Kitchen new-2"]);
  });

  it("filters New Kitchens Near You to the server's nearby answer (saved address / postal code)", async () => {
    vi.mocked(findNearbyKitchenIds).mockResolvedValue({ source: "saved-address", nearbyIds: ["new-2"] });
    render(<Marketplace merchants={MERCHANTS} />);
    const section = (await screen.findByRole("heading", { name: "New Kitchens Near You" })).closest("section")!;
    await waitFor(() => expect(within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Kitchen new-2"]));
  });

  it("hides the whole section when no new kitchen is nearby", async () => {
    vi.mocked(findNearbyKitchenIds).mockResolvedValue({ source: "postal-code", nearbyIds: [] });
    render(<Marketplace merchants={MERCHANTS} />);
    await waitFor(() => expect(findNearbyKitchenIds).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: "New Kitchens Near You" })).toBeNull();
  });

  it("hides New Kitchens Near You while the customer is searching", async () => {
    render(<Marketplace merchants={MERCHANTS} />);
    await screen.findByRole("heading", { name: "New Kitchens Near You" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Kitchen" } });
    expect(screen.queryByRole("heading", { name: "New Kitchens Near You" })).toBeNull();
  });

  it("only gives the NEW pill to kitchens marked new", async () => {
    render(<Marketplace merchants={MERCHANTS} />);
    const popular = screen.getByRole("heading", { name: "Popular Near You" }).closest("section")!;
    const fresh = (await screen.findByRole("heading", { name: "New Kitchens Near You" })).closest("section")!;
    expect(within(popular).queryAllByText("NEW")).toHaveLength(0);
    expect(within(fresh).getAllByText("NEW")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "All Cooks & Stalls" }).closest("section")!.id).toBe("all-cooks");
  });

  it("adds new-kitchen slides to the hero carousel once the location is resolved", async () => {
    render(<Marketplace merchants={MERCHANTS} />);
    const carousel = screen.getByRole("region", { name: /Featured on/ });
    await waitFor(() => expect(within(carousel).getAllByRole("group")).toHaveLength(3 + 5));
    const links = within(carousel).getAllByRole("link", { hidden: true }).map((a) => a.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/merchant/new-1", "/merchant/new-2"]));
  });

  it("lights up deal badges and Today's Deals once the deals source exists", async () => {
    const deals: DealsFeed = { available: true, deals: [liveDeal("old-0"), liveDeal("old-1", "flash")] };
    render(<Marketplace merchants={MERCHANTS} deals={deals} />);
    await screen.findByRole("heading", { name: "Today's Deals Near You" });
    expect(screen.getAllByTestId("deal-badge").map((b) => b.textContent)).toEqual(expect.arrayContaining(["⚡FLASH", "🏷️DEALS"]));
  });
});

describe("MerchantCard deal badge", () => {
  it("is a button to the kitchen's deals section, below the NEW pill on grid cards", () => {
    render(<MerchantCard merchant={kitchen("k", { isNew: true })} dealBadge="deals" />);
    const badge = screen.getByTestId("deal-badge");
    expect(badge.className).toContain("is-grid-below-new");
    fireEvent.click(badge);
    expect(push).toHaveBeenCalledWith("/merchant/k#deals");
  });

  it("sits top-left without a NEW pill, and in the info row on list cards", () => {
    render(<MerchantCard merchant={kitchen("k")} dealBadge="flash" />);
    expect(screen.getByTestId("deal-badge").className).toMatch(/is-grid( |$)/);
    cleanup();
    render(<MerchantCard merchant={kitchen("k")} variant="list" dealBadge="flash" />);
    expect(screen.getByTestId("deal-badge").className).toContain("is-list");
  });

  it("never shows on a blocked kitchen or without a deal", () => {
    render(<MerchantCard merchant={kitchen("k", { isBlocked: true })} dealBadge="deals" />);
    expect(screen.queryByTestId("deal-badge")).toBeNull();
    cleanup();
    render(<MerchantCard merchant={kitchen("k")} />);
    expect(screen.queryByTestId("deal-badge")).toBeNull();
  });
});

describe("HomeCarousel", () => {
  const newSlide = (id: string): HeroSlide => ({ type: "new-kitchen", key: `new-${id}`, kitchen: kitchen(id), image: "/categories/hawkers.jpg" });
  const slides: HeroSlide[] = [...BRAND_ONLY, newSlide("a"), newSlide("b")];
  const [cookingNearby, realPeople] = BRAND_IMAGE_SLIDES;
  const dots = () => screen.getAllByRole("button", { name: /Show slide/ });
  const active = () => dots().findIndex((d) => d.getAttribute("aria-current") === "true");

  it("is a labelled carousel with no dots for the brand slide alone", () => {
    render(<HomeCarousel slides={BRAND_ONLY} allCooksId="all-cooks" />);
    const carousel = screen.getByRole("region", { name: /Featured on/ });
    expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.queryAllByRole("button", { name: /Show slide/ })).toHaveLength(0);
  });

  it("autoplays every 5 seconds, pauses while touched and when the tab is hidden", () => {
    vi.useFakeTimers();
    render(<HomeCarousel slides={slides} allCooksId="all-cooks" />);
    expect(active()).toBe(0);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(active()).toBe(1);

    const track = screen.getByRole("region", { name: /Featured on/ }).querySelector(".kb-hero-track")!;
    fireEvent.pointerDown(track, { pointerType: "touch" });
    act(() => void vi.advanceTimersByTime(30_000));
    expect(active()).toBe(1);
    fireEvent.pointerUp(track, { pointerType: "touch" });
    act(() => void vi.advanceTimersByTime(5_000));
    expect(active()).toBe(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(active()).toBe(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    act(() => void vi.advanceTimersByTime(5_000));
    expect(active()).toBe(0); // wraps around
  });

  it("does not autoplay with prefers-reduced-motion", () => {
    vi.useFakeTimers();
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} })) as never;
    try {
      render(<HomeCarousel slides={slides} allCooksId="all-cooks" />);
      act(() => void vi.advanceTimersByTime(30_000));
      expect(active()).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });

  it("changes slide with the arrow keys and dots, and makes hidden slides inert", () => {
    render(<HomeCarousel slides={slides} allCooksId="all-cooks" />);
    const track = screen.getByRole("region", { name: /Featured on/ }).querySelector(".kb-hero-track")!;
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(active()).toBe(1);
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(active()).toBe(0);
    fireEvent.click(dots()[2]);
    expect(active()).toBe(2);
    const groups = screen.getAllByRole("group", { hidden: true });
    expect(groups.map((g) => g.hasAttribute("inert"))).toEqual([true, true, false]);
  });

  it("links only the cooking-nearby banner, to All Cooks & Stalls, and only when that list is on the page", () => {
    const banners = [...BRAND_ONLY, cookingNearby, realPeople];
    const { rerender } = render(<HomeCarousel slides={banners} allCooksId="all-cooks" />);
    expect(screen.getByRole("link", { hidden: true, name: /cooking nearby/ })).toHaveAttribute("href", "#all-cooks");
    expect(screen.getByRole("img", { hidden: true, name: /Real people/ }).closest("a")).toBeNull();
    rerender(<HomeCarousel slides={banners} allCooksId={null} />);
    expect(screen.queryAllByRole("link", { hidden: true })).toHaveLength(0);
    expect(screen.getByRole("img", { hidden: true, name: /cooking nearby/ })).toBeInTheDocument();
  });

  it("draws each banner once, filling the card from its own focal point, with no blurred backdrop", () => {
    const tuned = { ...realPeople, focus: "30% center" };
    const { container } = render(<HomeCarousel slides={[...BRAND_ONLY, cookingNearby, tuned]} allCooksId="all-cooks" />);
    const banners = [...container.querySelectorAll(".kb-hero-banner")];
    expect(banners).toHaveLength(2);
    expect(banners.map((b) => b.querySelectorAll("img").length)).toEqual([1, 1]);
    const imgs = banners.map((b) => b.querySelector("img")!);
    expect(imgs.map((i) => i.className)).toEqual(["kb-hero-banner-image", "kb-hero-banner-image"]);
    expect(imgs.map((i) => i.style.objectPosition)).toEqual(["left center", "30% center"]);
    expect(container.querySelector(".kb-hero-banner-backdrop")).toBeNull();
  });

  it("shows a banner for 4 seconds and every other slide for 5", () => {
    vi.useFakeTimers();
    render(<HomeCarousel slides={[...BRAND_ONLY, cookingNearby, realPeople]} allCooksId="all-cooks" />);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(active()).toBe(1);
    act(() => void vi.advanceTimersByTime(3_999));
    expect(active()).toBe(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(active()).toBe(2);
    act(() => void vi.advanceTimersByTime(4_000));
    expect(active()).toBe(0);
    act(() => void vi.advanceTimersByTime(4_999));
    expect(active()).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(active()).toBe(1);
  });

  it("uses smaller dots once there are more than 8 slides", () => {
    const { rerender } = render(<HomeCarousel slides={[...BRAND_ONLY, ...BRAND_IMAGE_SLIDES]} allCooksId="all-cooks" />);
    expect(dots()[0].parentElement).not.toHaveClass("is-compact");
    rerender(<HomeCarousel slides={[...slides, newSlide("c"), newSlide("d"), newSlide("e"), ...BRAND_IMAGE_SLIDES]} allCooksId="all-cooks" />);
    expect(dots()).toHaveLength(11);
    expect(dots()[0].parentElement).toHaveClass("is-compact");
  });
});
