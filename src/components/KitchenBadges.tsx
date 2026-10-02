import type { MerchantCategory } from "@/lib/types";

export const CATEGORY_LABEL: Record<MerchantCategory, string> = {
  "home-cook": "Home Cook",
  hawker: "Hawker",
  bakery: "Bakery",
  "bulk-orders": "Vegetarian",
  drinks: "Desserts & Drinks",
};

const CATEGORY_PILL: Record<MerchantCategory, { bg: string; fg: string }> = {
  "home-cook": { bg: "var(--kb-cat-homecook-bg)", fg: "var(--kb-cat-homecook-fg)" },
  hawker: { bg: "var(--kb-cat-hawker-bg)", fg: "var(--kb-cat-hawker-fg)" },
  bakery: { bg: "var(--kb-cat-bakery-bg)", fg: "var(--kb-cat-bakery-fg)" },
  "bulk-orders": { bg: "var(--kb-cat-bulkorders-bg)", fg: "var(--kb-cat-bulkorders-fg)" },
  drinks: { bg: "var(--kb-cat-drinks-bg)", fg: "var(--kb-cat-drinks-fg)" },
};

/** The kitchen's own category, as the cook chose it — not a verified claim. */
export function CategoryPill({ category }: { category: MerchantCategory }) {
  const pill = CATEGORY_PILL[category];
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: pill.bg, color: pill.fg }}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/**
 * Shown only when the kitchen has a business_uen, which the database copies
 * from the cook's HQ-approved application and never takes from the cook
 * (Partner app's docs/supabase-schema.sql section 27). That's what makes it a
 * trust signal, unlike the self-chosen category. `showUen` adds the number
 * itself so a customer can look it up on ACRA BizFile.
 */
export function RegisteredBadge({ uen, showUen = false }: { uen: string; showUen?: boolean }) {
  return (
    <span
      data-testid="registered-badge"
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: "var(--kb-green-deep)", color: "white" }}
      title={`Registered business · UEN ${uen}`}
    >
      <CheckIcon /> Registered business{showUen && <span className="font-medium opacity-90">· UEN {uen}</span>}
    </span>
  );
}

/**
 * "4.6 (23 ratings)", or "No ratings yet" for a kitchen nobody has rated —
 * never a misleading 0.0. <RatingSummary> adds the star in front.
 */
export function formatRatingSummary(rating: number, count: number): string {
  if (count <= 0) return "No ratings yet";
  return `${rating.toFixed(1)} (${count} ${count === 1 ? "rating" : "ratings"})`;
}

/** "★ 4.6 (23 ratings)" / "No ratings yet" — shared by the marketplace card and the kitchen page. */
export function RatingSummary({ rating, count }: { rating: number; count: number }) {
  return (
    <span data-testid="rating-summary" className="inline-flex items-center gap-1">
      {count > 0 && <StarIcon />}
      {formatRatingSummary(rating, count)}
    </span>
  );
}

function StarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--kb-warn)" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
