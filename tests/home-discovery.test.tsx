import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Marketplace } from "@/components/Marketplace";
import { HomeCarousel } from "@/components/HomeCarousel";
import { MerchantCard } from "@/components/MerchantCard";
import { findNearbyKitchenIds } from "@/lib/home-actions";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  it("keeps the hero carousel and existing sections, and hides every deal surface while the deals source is missing", async () => {
    render(<Marketplace merchants={MERCHANTS} />);
    const hero = screen.getByRole("region", { name: /Featured on/ });
    expect(within(hero).getByRole("img", { name: /Something good is cooking nearby/ })).toBeInTheDocument();
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

  it("shows only the designed images in the hero: no brand card, deal or new-kitchen slides", async () => {
    const deals: DealsFeed = { available: true, deals: [liveDeal("old-0"), liveDeal("old-1", "flash")] };
    render(<Marketplace merchants={MERCHANTS} deals={deals} />);
    await screen.findByRole("heading", { name: "Today's Deals Near You" }); // deals and new kitchens are loaded
    const carousel = screen.getByRole("region", { name: /Featured on/ });
    const frames = [...carousel.querySelectorAll(".kb-hero-frame")].map((f) => f.getAttribute("data-key"));
    expect(frames).toEqual(["01-browse", "02-real-people", "03-simple", "04-riders", "05-deepavali", "06-christmas", "07-new-year", "08-cny", "09-national-day"]);
    expect(within(carousel).queryByText(/Good food,|FLASH DEAL|DEAL|NEW/)).toBeNull();
    const links = within(carousel).queryAllByRole("link", { hidden: true }).map((a) => a.getAttribute("href"));
    expect(links.every((href) => href === "#all-cooks")).toBe(true);
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
  const ALWAYS = ["01-browse", "02-real-people", "03-simple", "04-riders"];
  /** 10:00 on 20 Nov 2026 in Singapore: no festive window open. */
  const OFF_SEASON = "2026-11-20T02:00:00Z";
  const carousel = () => screen.getByRole("region", { name: /Featured on/ });
  const current = () => carousel().querySelector(".kb-hero-frame.is-current")?.getAttribute("data-key");
  const dots = () => [...carousel().querySelectorAll(".kb-hero-dots span")];
  const activeDot = () => dots().findIndex((d) => d.classList.contains("is-active"));
  const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const at = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it("is a labelled carousel with no buttons at all: no arrows, and dots that only show position", () => {
    at(OFF_SEASON);
    render(<HomeCarousel allCooksId="all-cooks" />);
    expect(carousel()).toHaveAttribute("aria-roledescription", "carousel");
    expect(within(carousel()).queryAllByRole("button", { hidden: true })).toHaveLength(0);
    expect(carousel().querySelectorAll("[tabindex]")).toHaveLength(0);
    expect(carousel().querySelector(".kb-hero-dots")).toHaveAttribute("aria-hidden", "true");
    expect(dots().map((d) => d.tagName)).toEqual(Array(4).fill("SPAN"));
    expect(activeDot()).toBe(0);
  });

  it("shows every slide for exactly 4 seconds", () => {
    at(OFF_SEASON);
    render(<HomeCarousel allCooksId="all-cooks" />);
    expect(current()).toBe("01-browse");
    tick(3_999);
    expect(current()).toBe("01-browse");
    tick(1);
    expect(current()).toBe("02-real-people");
    tick(3_999);
    expect(current()).toBe("02-real-people");
    tick(1);
    expect(current()).toBe("03-simple");
    expect(activeDot()).toBe(2);
  });

  it("only moves forward: the old slide leaves to the left, and after the last comes the first", () => {
    at(OFF_SEASON);
    render(<HomeCarousel allCooksId="all-cooks" />);
    const seen = [current()];
    for (let i = 0; i < 5; i++) {
      tick(4_000);
      seen.push(current());
    }
    expect(seen).toEqual([...ALWAYS, "01-browse", "02-real-people"]);

    // Mid-move the outgoing slide is leaving (to the left); once it's gone it waits on the right again.
    tick(4_000);
    const frame = (key: string) => carousel().querySelector(`[data-key="${key}"]`)!;
    expect(frame("03-simple")).toHaveClass("is-current");
    expect(frame("02-real-people")).toHaveClass("is-leaving");
    tick(800);
    expect(frame("02-real-people")).toHaveClass("is-waiting");
    expect(carousel().querySelectorAll(".is-leaving")).toHaveLength(0);
  });

  it("never pauses or goes back for touch, mouse, keyboard focus or arrow keys", () => {
    at(OFF_SEASON);
    render(<HomeCarousel allCooksId="all-cooks" />);
    tick(2_000);
    const region = carousel();
    fireEvent.pointerDown(region, { pointerType: "touch" });
    fireEvent.pointerEnter(region, { pointerType: "mouse" });
    fireEvent.mouseEnter(region);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    fireEvent.focus(region.querySelector("a")!);
    expect(current()).toBe("01-browse");
    tick(2_000);
    expect(current()).toBe("02-real-people");
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    fireEvent.keyDown(region, { key: "ArrowRight" });
    fireEvent.pointerUp(region, { pointerType: "touch" });
    tick(4_000);
    expect(current()).toBe("03-simple");
  });

  it("pauses only while the browser tab is hidden", () => {
    at(OFF_SEASON);
    render(<HomeCarousel allCooksId="all-cooks" />);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    tick(60_000);
    expect(current()).toBe("01-browse");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    tick(4_000);
    expect(current()).toBe("02-real-people");
  });

  it("keeps the same 4-second beat with prefers-reduced-motion (the CSS makes it a cut)", () => {
    at(OFF_SEASON);
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} })) as never;
    try {
      render(<HomeCarousel allCooksId="all-cooks" />);
      tick(8_000);
      expect(current()).toBe("03-simple");
    } finally {
      window.matchMedia = original;
    }
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.kb-hero-frame\.is-current, \.kb-hero-frame\.is-leaving[^}]*transition:none/);
  });

  it("brings a festive slide in at the first slide change after its window opens (Singapore midnight)", () => {
    at("2026-11-30T15:59:48Z"); // 23:59:48 on 30 Nov in Singapore
    render(<HomeCarousel allCooksId="all-cooks" />);
    expect(dots()).toHaveLength(4);
    tick(12_000); // 04 comes in at 00:00:00 on 1 Dec
    expect(current()).toBe("04-riders");
    tick(4_000);
    expect(current()).toBe("06-christmas");
    expect(dots()).toHaveLength(5);
    tick(4_000);
    expect(current()).toBe("01-browse");
  });

  it("drops a festive slide at the first slide change after its window closes, without going back", () => {
    at("2026-11-09T15:59:48Z"); // 23:59:48 on 9 Nov in Singapore, the last Deepavali day
    render(<HomeCarousel allCooksId="all-cooks" />);
    expect(dots()).toHaveLength(5);
    tick(12_000);
    expect(current()).toBe("04-riders");
    tick(4_000);
    expect(current()).toBe("01-browse"); // skips 05, now out of season
    expect(dots()).toHaveLength(4);
  });

  it("links 01 and the festive slides to All Cooks & Stalls, only while that list is on the page", () => {
    at("2026-12-10T02:00:00Z"); // Christmas window
    const { rerender } = render(<HomeCarousel allCooksId="all-cooks" />);
    const linked = within(carousel())
      .getAllByRole("link", { hidden: true })
      .map((a) => [a.closest(".kb-hero-frame")!.getAttribute("data-key"), a.getAttribute("href")]);
    expect(linked).toEqual([
      ["01-browse", "#all-cooks"],
      ["05-deepavali", "#all-cooks"],
      ["06-christmas", "#all-cooks"],
      ["07-new-year", "#all-cooks"],
      ["08-cny", "#all-cooks"],
      ["09-national-day", "#all-cooks"],
    ]);
    expect(within(carousel()).getByRole("img", { hidden: true, name: /Delivering goodness together/ }).closest("a")).toBeNull();
    rerender(<HomeCarousel allCooksId={null} />);
    expect(within(carousel()).queryAllByRole("link", { hidden: true })).toHaveLength(0);
  });

  it("gives every image alt text; the first loads up front, the next one early, the rest lazily", () => {
    at(OFF_SEASON);
    render(<HomeCarousel allCooksId="all-cooks" />);
    const imgs = [...carousel().querySelectorAll("img")];
    expect(imgs).toHaveLength(9);
    for (const img of imgs) expect(img.getAttribute("alt")!.length).toBeGreaterThan(40);
    expect(imgs.map((i) => i.getAttribute("loading"))).toEqual(["eager", "eager", ...Array(7).fill("lazy")]);
    expect(imgs[0]).toHaveAttribute("fetchpriority", "high");
    tick(4_000);
    expect([...carousel().querySelectorAll("img")].map((i) => i.getAttribute("loading")).slice(0, 4)).toEqual(["eager", "eager", "eager", "lazy"]);
  });

  it("shows every image whole: no zoom or other transform on any picture", () => {
    at(OFF_SEASON);
    render(<HomeCarousel allCooksId="all-cooks" />);
    for (const img of carousel().querySelectorAll("img")) {
      expect(img.style.transform).toBe("");
      expect(img.className).toBe("kb-hero-image");
    }
  });

  it("sits in a fixed 2:1 frame, 560 x 280 at most and centred, with the dots in their own row", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.kb-hero-carousel \{[^}]*max-width:560px[^}]*margin:8px auto 0/);
    expect(css).toMatch(/\.kb-hero-viewport \{[^}]*aspect-ratio:2\/1[^}]*overflow:hidden/);
    expect(css).toMatch(/\.kb-hero-image \{ object-fit:cover; object-position:center; \}/);
    expect(css).toMatch(/\.kb-hero-dots \{ display:flex; height:6px;/);
  });
});
