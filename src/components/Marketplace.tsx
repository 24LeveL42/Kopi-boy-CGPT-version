"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CUISINES } from "@/lib/demo-data";
import { Merchant, MerchantCategory, CuisineType } from "@/lib/types";
import { haversineDistanceKm } from "@/lib/distance";
import { useCustomerLocation } from "@/lib/use-customer-location";
import { useCart } from "@/lib/cart-context";
import { useIsClient } from "@/lib/use-is-client";
import { useNow } from "@/lib/use-now";
import { useNearbyKitchens } from "@/lib/use-nearby-kitchens";
import { selectNewKitchens } from "@/lib/new-kitchens";
import { NO_DEALS, dealBadges, selectTodaysDeals, showableDeals, type DealsFeed } from "@/lib/deals";
import { BRAND_ONLY, readVisitorOffset, rotationSeed, selectHeroSlides } from "@/lib/hero-slides";
import { SearchBar } from "./SearchBar";
import { CategoryGrid } from "./CategoryGrid";
import { CuisineFilter } from "./CuisineFilter";
import { MerchantGrid } from "./MerchantGrid";
import { TopBar } from "./TopBar";
import { HomeCarousel } from "./HomeCarousel";
import { TodaysDeals } from "./TodaysDeals";
import { BottomNav } from "./BottomNav";

export function filterMerchants(merchants: Merchant[], query: string, category: MerchantCategory | "all", cuisine: CuisineType | "all" = "all"): Merchant[] {
  const q = query.trim().toLowerCase();
  return merchants.filter((m) => {
    if (category !== "all" && m.category !== category) return false;
    if (cuisine !== "all" && m.cuisineType !== cuisine) return false;
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.cuisine.toLowerCase().includes(q) || (m.area?.toLowerCase().includes(q) ?? false) || m.menuHighlights.some((item) => item.name.toLowerCase().includes(q));
  });
}

const ALL_COOKS_ID = "all-cooks";

export function Marketplace({ merchants, deals = NO_DEALS }: { merchants: Merchant[]; deals?: DealsFeed }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MerchantCategory | "all">("all");
  const [cuisine, setCuisine] = useState<CuisineType | "all">("all");
  const { coords } = useCustomerLocation();
  const { itemCount, subtotal } = useCart();
  const withDistance = useMemo(() => !coords ? merchants : merchants.map((m) => m.latitude != null && m.longitude != null ? { ...m, distanceKm: haversineDistanceKm(coords.latitude, coords.longitude, m.latitude, m.longitude) } : m), [merchants, coords]);
  const filtered = useMemo(() => filterMerchants(withDistance, query, category, cuisine), [withDistance, query, category, cuisine]);
  const popular = useMemo(() => [...withDistance].sort((a, b) => Number(!!a.isBlocked) - Number(!!b.isBlocked) || b.rating - a.rating).slice(0, 6), [withDistance]);
  const isBrowsing = query.trim() !== "" || category !== "all" || cuisine !== "all";

  // Display-only discovery: new kitchens, deals (hidden until the deals data source exists) and the hero carousel.
  const isClient = useIsClient();
  const now = useNow(60_000);
  const nearby = useNearbyKitchens(merchants, coords);
  const merchantsById = useMemo(() => new Map(withDistance.map((m) => [m.id, m])), [withDistance]);
  const popularIds = useMemo(() => new Set(popular.map((m) => m.id)), [popular]);
  const newNearby = useMemo(() => (nearby.ready ? selectNewKitchens(withDistance, { nearbyIds: nearby.nearbyIds }) : []), [nearby.ready, nearby.nearbyIds, withDistance]);
  const newSection = useMemo(() => newNearby.filter((m) => !popularIds.has(m.id)), [newNearby, popularIds]);
  const liveDeals = useMemo(() => (isClient ? showableDeals(deals, merchantsById, now) : []), [isClient, deals, merchantsById, now]);
  const nearbyDeals = useMemo(() => (nearby.ready ? liveDeals.filter((d) => !nearby.nearbyIds || nearby.nearbyIds.has(d.kitchenId)) : []), [nearby.ready, nearby.nearbyIds, liveDeals]);
  const badges = useMemo(() => dealBadges(liveDeals), [liveDeals]);
  const todaysDeals = useMemo(() => selectTodaysDeals(nearbyDeals, null), [nearbyDeals]);
  const visitorOffset = useMemo(() => (isClient ? readVisitorOffset() : 0), [isClient]);
  const heroSlides = useMemo(
    () =>
      isClient && nearby.ready
        ? selectHeroSlides({ flashDeals: nearbyDeals.filter((d) => d.kind === "flash"), promotions: nearbyDeals.filter((d) => d.kind !== "flash"), newKitchens: newNearby, merchantsById, seed: rotationSeed(visitorOffset) })
        : BRAND_ONLY,
    [isClient, nearby.ready, nearbyDeals, newNearby, merchantsById, visitorOffset]
  );

  return <div className="kb-app-shell min-h-screen pb-28">
    <div className="mx-auto max-w-3xl px-4 pb-2 pt-3 sm:px-6 lg:px-8">
      <TopBar location="Nearby" />
      <HomeCarousel slides={heroSlides} allCooksId={isBrowsing ? null : ALL_COOKS_ID} />
      <div className="mt-4"><SearchBar value={query} onChange={setQuery} /></div>
      <div className="mt-4"><CategoryGrid active={category} onSelect={setCategory} /></div>
      <div className="mt-3"><CuisineFilter cuisines={CUISINES} active={cuisine} onSelect={setCuisine} /></div>
    </div>

    <main className="mx-auto max-w-3xl space-y-9 px-4 py-6 sm:px-6 lg:px-8">
      {isBrowsing ? <MerchantGrid merchants={filtered} heading={category === "all" ? `Results for "${query || cuisineLabel(cuisine)}"` : categoryLabel(category)} dealBadges={badges} /> : <><TodaysDeals deals={todaysDeals} merchantsById={merchantsById} /><MerchantGrid merchants={popular} heading="Popular Near You" showSeeAll variant="grid" dealBadges={badges} />{newSection.length > 0 && <MerchantGrid merchants={newSection} heading="New Kitchens Near You" subheading="Just opened in your neighbourhood." variant="row" dealBadges={badges} />}<MerchantGrid id={ALL_COOKS_ID} merchants={withDistance} heading="All Cooks & Stalls" variant="list" dealBadges={badges} /></>}
    </main>

    {itemCount > 0 && <Link href="/cart" className="kb-floating-cart"><span className="kb-floating-cart-icon">🛍</span><span><b>{itemCount} {itemCount===1?"item":"items"}</b><small>View your cart</small></span><strong>${subtotal.toFixed(2)}</strong><span className="text-lg">›</span></Link>}
    <BottomNav />
  </div>;
}
function categoryLabel(id: MerchantCategory) { return ({"home-cook":"Home Cooks",hawker:"Hawkers",bakery:"Bakery","bulk-orders":"Vegetarian",drinks:"Desserts & Drinks"} as Record<MerchantCategory,string>)[id]; }
function cuisineLabel(id: CuisineType | "all") { return CUISINES.find((c) => c.id === id)?.label ?? ""; }
