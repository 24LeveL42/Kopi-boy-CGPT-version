import Link from "next/link";
import { LEGAL_ENTITY_LINE, LEGAL_LINKS } from "@/lib/legal-links";

/**
 * One small line at the foot of every page: who runs the site, plus the
 * Terms and Privacy links. Bottom padding keeps it clear of the fixed
 * bottom nav.
 */
export function SiteFooter() {
  return (
    <footer className="px-4 pt-4 pb-28 text-center text-[11px] leading-5 text-slate-400" data-testid="site-footer">
      <span>{LEGAL_ENTITY_LINE}</span>
      {LEGAL_LINKS.map((l) => (
        <span key={l.href}>
          {" · "}
          <Link href={l.href} className="underline underline-offset-2 hover:text-slate-600">
            {l.label}
          </Link>
        </span>
      ))}
    </footer>
  );
}
