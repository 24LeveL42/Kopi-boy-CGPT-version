import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { MerchantCard } from "@/components/MerchantCard";
import type { Merchant } from "@/lib/types";

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "k-1",
    name: "Ah Seng Char Kway Teow",
    category: "hawker",
    cuisine: "Chinese",
    area: "Postal sector 31",
    blurb: "",
    rating: 0,
    ratingCount: 0,
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

afterEach(cleanup);

describe("MerchantCard — category + registered-business badges", () => {
  it("shows the Registered business badge for a kitchen with an approved UEN", () => {
    const { container } = render(<MerchantCard merchant={merchant({ businessUen: "53123456X" })} />);
    expect(within(container).getByText("Hawker")).toBeInTheDocument();
    const badge = within(container).getByTestId("registered-badge");
    expect(badge).toHaveTextContent("Registered business");
    // The card keeps it short; the number itself is on the detail page.
    expect(badge).not.toHaveTextContent("53123456X");
  });

  it("shows no badge for a home cook (no UEN), only the Home Cook pill", () => {
    const { container } = render(<MerchantCard merchant={merchant({ category: "home-cook", businessUen: null })} />);
    expect(within(container).getByText("Home Cook")).toBeInTheDocument();
    expect(within(container).queryByTestId("registered-badge")).toBeNull();
  });

  it("doesn't trust the self-chosen category: a 'Hawker' kitchen without an approved UEN gets no badge", () => {
    const { container } = render(<MerchantCard merchant={merchant({ category: "hawker" })} />);
    expect(within(container).getByText("Hawker")).toBeInTheDocument();
    expect(within(container).queryByTestId("registered-badge")).toBeNull();
  });

  it("shows the average and count once a kitchen has ratings", () => {
    const { container } = render(<MerchantCard merchant={merchant({ rating: 4.6, ratingCount: 23 })} />);
    expect(within(container).getByTestId("rating-summary")).toHaveTextContent("4.6 (23 ratings)");
  });

  it("says No ratings yet instead of 0.0 for an unrated kitchen", () => {
    const { container } = render(<MerchantCard merchant={merchant({ rating: 0, ratingCount: 0 })} />);
    expect(within(container).getByTestId("rating-summary")).toHaveTextContent("No ratings yet");
    expect(container).not.toHaveTextContent("0.0");
  });

  it("uses the singular for a single rating", () => {
    const { container } = render(<MerchantCard merchant={merchant({ rating: 5, ratingCount: 1 })} />);
    expect(within(container).getByTestId("rating-summary")).toHaveTextContent("5.0 (1 rating)");
  });

  it("shows the postal sector when there is one, and just the distance when there isn't", () => {
    const withArea = render(<MerchantCard merchant={merchant({ area: "Postal sector 31" })} />);
    expect(withArea.container).toHaveTextContent("Postal sector 31 · Distance unavailable");
    cleanup();
    const { container } = render(<MerchantCard merchant={merchant({ area: null })} />);
    expect(container).toHaveTextContent("Distance unavailable");
    expect(container).not.toHaveTextContent("null");
  });
});
