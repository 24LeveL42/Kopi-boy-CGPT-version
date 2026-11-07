import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal-links";

/** Terms + Privacy links for the Help and About pages. */
export function LegalLinks() {
  return (
    <section className="kb-profile-menu mt-4" data-testid="legal-links">
      {LEGAL_LINKS.map((l) => (
        <Link key={l.label} href={l.href} className="kb-profile-link">
          <span>{l.label}</span>
          <span className="ml-auto text-slate-300">›</span>
        </Link>
      ))}
    </section>
  );
}
