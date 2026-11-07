import Link from "next/link";
import { LegalMarkdown } from "@/lib/legal-markdown";
import { readLegalDoc, type LegalDoc } from "@/lib/legal-content";

const OTHER: Record<LegalDoc, { href: string; label: string }> = {
  terms: { href: "/privacy", label: "Read our Privacy Policy" },
  privacy: { href: "/terms", label: "Read our Terms of Use" },
};

/** Public Terms / Privacy page: the owner's text, then a link to the other page. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const other = OTHER[doc];
  return (
    <div className="kb-app-shell min-h-screen pb-10">
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <p className="kb-eyebrow">LEGAL</p>
        <article className="kb-cart-card mt-2" data-testid={`legal-${doc}`}>
          <LegalMarkdown source={readLegalDoc(doc)} />
        </article>
        <nav aria-label="Legal" className="kb-profile-menu mt-4">
          <Link href={other.href} className="kb-profile-link">
            <span>{other.label}</span>
            <span className="ml-auto text-slate-300">›</span>
          </Link>
        </nav>
      </main>
    </div>
  );
}
