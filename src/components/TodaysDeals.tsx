import Link from "next/link";
import { describeDeal, dealHref, type KitchenDeal } from "@/lib/deals";
import type { Merchant } from "@/lib/types";

/**
 * "Today's Deals Near You" — one compact, swipeable row. Renders nothing
 * when there are no deals, which is always the case until the deals data
 * source exists (Phase C). Wording comes only from describeDeal().
 */
export function TodaysDeals({ deals, merchantsById }: { deals: KitchenDeal[]; merchantsById: ReadonlyMap<string, Merchant> }) {
  const cards = deals.flatMap((deal) => {
    const kitchen = merchantsById.get(deal.kitchenId);
    const wording = describeDeal(deal);
    return kitchen && wording ? [{ deal, kitchen, wording }] : [];
  });
  if (cards.length === 0) return null;
  return (
    <section className="kb-section" aria-labelledby="todays-deals-heading">
      <div className="kb-section-heading">
        <div>
          <h2 id="todays-deals-heading">Today&apos;s Deals Near You</h2>
          <p>Offers from local kitchens, while they last.</p>
        </div>
      </div>
      <div className="kb-deal-row mt-3">
        {cards.map(({ deal, kitchen, wording }) => (
          <Link key={deal.id} href={dealHref(deal)} className="kb-deal-card">
            <span className={`kb-deal-badge is-${deal.kind === "flash" ? "flash" : "deals"} is-inline`}>{deal.kind === "flash" ? "⚡ FLASH" : "🏷️ DEAL"}</span>
            <b className="mt-2 block truncate text-[13px] text-slate-900">{kitchen.name}</b>
            <span className="mt-1 block text-[13px] font-extrabold leading-tight text-purple-700">{wording.label}</span>
            {wording.detail && <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">{wording.detail}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}
