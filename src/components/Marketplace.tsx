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
import { NEW_KITCHENS_RADIUS_KM, selectNewKitchens } from "@/lib/new-kitchens";
import { REGION_LABEL, anyRegion, orderByCloseness } from "@/lib/regions";
import { useCustomerRegion } from "@/lib/use-customer-region";
import { NO_DEALS, dealBadges, selectTodaysDeals, showableDeals, type DealsFeed } from "@/lib/deals";
import { SearchBar } from "./SearchBar";
import { CategoryGrid } from "./CategoryGrid";
import { CuisineFilter } from "./CuisineFilter";
import { RegionFilter, type RegionChoice } from "./RegionFilter";
import { MerchantGrid } from "./MerchantGrid";
import { TopBar } from "./TopBar";
import { HomeCarousel } from "./HomeCarousel";
import { TodaysDeals } from "./TodaysDeals";
import { BottomNav } from "./BottomNav";

export function filterMerchants(merchants: Merchant[], query: string, category: MerchantCategory | "all", cuisine: CuisineType | "all" = "all", region: RegionChoice = "all"): Merchant[] {
  const q = query.trim().toLowerCase();
  return merchants.filter((m) => {
    if (category !== "all" && m.category !== category) return false;
    if (region !== "all" && m.region !== region) return false;
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
  const [region, setRegion] = useState<RegionChoice>("all");
  const { coords } = useCustomerLocation();
  const { itemCount, subtotal } = useCart();
  const withDistance = useMemo(() => !coords ? merchants : merchants.map((m) => m.latitude != null && m.longitude != null ? { ...m, distanceKm: haversineDistanceKm(coords.latitude, coords.longitude, m.latitude, m.longitude) } : m), [merchants, coords]);

  const popular = useMemo(() => [...withDistance].sort((a, b) => Number(!!a.isBlocked) - Number(!!b.isBlocked) || b.rating - a.rating).slice(0, 6), [withDistance]);
  // Region chips only once some kitchen has a region (before that, picking one would empty the page).
  const showRegions = useMemo(() => anyRegion(merchants), [merchants]);
  const activeRegion: RegionChoice = showRegions ? region : "all";
  const isBrowsing = query.trim() !== "" || category !== "all" || cuisine !== "all" || activeRegion !== "all";

  // Display-only discovery: new kitchens and deals (hidden until the deals data source exists).
  const isClient = useIsClient();
  const now = useNow(60_000);
  const nearby = useNearbyKitchens(merchants, coords);
  const customerRegion = useCustomerRegion(showRegions);
  // Default order: nearby, then the customer's region, then the other regions, then no region (blocked last).
  const ordered = useMemo(() => orderByCloseness(withDistance, { nearbyIds: nearby.ready ? nearby.nearbyIds : null, customerRegion }), [withDistance, nearby.ready, nearby.nearbyIds, customerRegion]);
  const filtered = useMemo(() => filterMerchants(ordered, query, category, cuisine, activeRegion), [ordered, query, category, cuisine, activeRegion]);
  // A region with nothing in it (with the other filters): the same filters across every region instead.
  const otherRegions = useMemo(() => (activeRegion !== "all" && filtered.length === 0 ? filterMerchants(ordered, query, category, cuisine, "all") : []), [activeRegion, filtered.length, ordered, query, category, cuisine]);
  const noneNearby = showRegions && nearby.ready && nearby.source !== "none" && nearby.nearbyIds?.size === 0;
  const merchantsById = useMemo(() => new Map(withDistance.map((m) => [m.id, m])), [withDistance]);
  const popularIds = useMemo(() => new Set(popular.map((m) => m.id)), [popular]);
  const newNearby = useMemo(() => (nearby.ready ? selectNewKitchens(withDistance, { nearbyIds: nearby.nearbyIds }) : []), [nearby.ready, nearby.nearbyIds, withDistance]);
  const newSection = useMemo(() => newNearby.filter((m) => !popularIds.has(m.id)), [newNearby, popularIds]);
  const liveDeals = useMemo(() => (isClient ? showableDeals(deals, merchantsById, now) : []), [isClient, deals, merchantsById, now]);
  const nearbyDeals = useMemo(() => (nearby.ready ? liveDeals.filter((d) => !nearby.nearbyIds || nearby.nearbyIds.has(d.kitchenId)) : []), [nearby.ready, nearby.nearbyIds, liveDeals]);
  const badges = useMemo(() => dealBadges(liveDeals), [liveDeals]);
  const todaysDeals = useMemo(() => selectTodaysDeals(nearbyDeals, null), [nearbyDeals]);

  return <div className="kb-app-shell min-h-screen pb-28">
    <div className="mx-auto max-w-3xl px-4 pb-2 pt-3 sm:px-6 lg:px-8">
      <TopBar location="Nearby" />
      {/* Images only (src/lib/hero-slides.ts HERO_IMAGES); the brand card and deal / new-kitchen slides are no longer shown here. */}
      <HomeCarousel allCooksId={isBrowsing ? null : ALL_COOKS_ID} />
      <div className="mt-4"><SearchBar value={query} onChange={setQuery} /></div>
      <div className="mt-4"><CategoryGrid active={category} onSelect={setCategory} /></div>
      <div className="mt-3"><CuisineFilter cuisines={CUISINES} active={cuisine} onSelect={setCuisine} /></div>
      {showRegions && <div className="mt-3"><RegionFilter active={activeRegion} onSelect={setRegion} /></div>}
    </div>

    <main className="mx-auto max-w-3xl space-y-9 px-4 py-6 sm:px-6 lg:px-8">
      {isBrowsing ? (activeRegion !== "all" && filtered.length === 0 ? <><RegionEmpty region={REGION_LABEL[activeRegion]} filtered={query.trim() !== "" || category !== "all" || cuisine !== "all"} onShowAll={() => setRegion("all")} />{otherRegions.length > 0 && <MerchantGrid merchants={otherRegions} heading="Kitchens in other regions" subheading="Closest first." dealBadges={badges} />}</> : <MerchantGrid merchants={filtered} heading={browseHeading(query, category, cuisine, activeRegion)} dealBadges={badges} />) : <><TodaysDeals deals={todaysDeals} merchantsById={merchantsById} /><MerchantGrid merchants={popular} heading="Popular Near You" showSeeAll variant="grid" dealBadges={badges} />{newSection.length > 0 && <MerchantGrid merchants={newSection} heading="New Kitchens Near You" subheading="Just opened in your neighbourhood." variant="row" dealBadges={badges} />}{noneNearby && <p role="status" className="text-sm text-slate-600">No kitchens within {NEW_KITCHENS_RADIUS_KM} km yet. {customerRegion ? `Showing ${REGION_LABEL[customerRegion]} first, then other regions.` : "Showing every region."}</p>}<MerchantGrid id={ALL_COOKS_ID} merchants={ordered} heading="All Cooks & Stalls" variant="list" dealBadges={badges} /></>}
    </main>

    {itemCount > 0 && <Link href="/cart" className="kb-floating-cart"><span className="kb-floating-cart-icon">🛍</span><span><b>{itemCount} {itemCount===1?"item":"items"}</b><small>View your cart</small></span><strong>${subtotal.toFixed(2)}</strong><span className="text-lg">›</span></Link>}
    <BottomNav />
  </div>;
}
/** Why a region chip found nothing, and the way back to every region. */
function RegionEmpty({ region, filtered, onShowAll }: { region: string; filtered: boolean; onShowAll: () => void }) {
  return <section role="status" className="kb-empty-state">
    <div className="kb-empty-icon" aria-hidden="true">⌕</div>
    <p className="font-extrabold">No kitchens in {region}{filtered ? " match your filters" : " yet"}</p>
    <p className="mt-1 text-sm text-slate-500">{filtered ? `Nothing in ${region} matches your search, category or cuisine.` : `No cook or stall in ${region} is on Kopi Boy yet.`} Kitchens from other regions are below.</p>
    <button type="button" onClick={onShowAll} className="kb-chip is-active mt-3">Show all regions</button>
  </section>;
}
function browseHeading(query: string, category: MerchantCategory | "all", cuisine: CuisineType | "all", region: RegionChoice) {
  if (category !== "all") return categoryLabel(category);
  if (query.trim()) return `Results for "${query}"`;
  if (cuisine !== "all") return `Results for "${cuisineLabel(cuisine)}"`;
  return region !== "all" ? `Kitchens in ${REGION_LABEL[region]}` : "All Cooks & Stalls";
}
function categoryLabel(id: MerchantCategory) { return ({"home-cook":"Home Cooks",hawker:"Hawkers",bakery:"Bakery","bulk-orders":"Vegetarian",drinks:"Desserts & Drinks"} as Record<MerchantCategory,string>)[id]; }
function cuisineLabel(id: CuisineType | "all") { return CUISINES.find((c) => c.id === id)?.label ?? ""; }
