import { LEGAL_LINKS } from "@/lib/legal-links";

/** Terms + Privacy links for the Help and About pages; renders nothing until a URL is set. */
export function LegalLinks() {
  const links = LEGAL_LINKS.filter((l): l is { label: string; href: string } => Boolean(l.href));
  if (links.length === 0) return null;
  return (
    <section className="kb-profile-menu mt-4" data-testid="legal-links">
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="kb-profile-link">
          <span>{l.label}</span>
          <span className="ml-auto text-slate-300">›</span>
        </a>
      ))}
    </section>
  );
}
