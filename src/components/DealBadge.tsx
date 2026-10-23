"use client";

import { useRouter } from "next/navigation";
import type { DealBadgeKind } from "@/lib/deals";

/**
 * 🏷️ DEALS / ⚡ FLASH on a kitchen card. A button inside the card's link
 * (like the heart), so tapping it opens the kitchen's deals section rather
 * than the top of the kitchen page. Only rendered when the kitchen has a live
 * deal, which needs the deals data source (Phase C).
 */
export function DealBadge({ kitchenId, kind, variant }: { kitchenId: string; kind: DealBadgeKind; variant: "grid" | "grid-below-new" | "list" }) {
  const router = useRouter();
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/merchant/${kitchenId}#deals`);
  };
  const label = kind === "flash" ? "Flash deal" : "Deals";
  return (
    <button type="button" onClick={open} aria-label={`${label} — see this kitchen's deals`} data-testid="deal-badge" className={`kb-deal-badge is-${kind} is-${variant}`}>
      <span aria-hidden="true">{kind === "flash" ? "⚡" : "🏷️"}</span>
      {kind === "flash" ? "FLASH" : "DEALS"}
    </button>
  );
}
