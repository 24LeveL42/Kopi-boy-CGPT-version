import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CartProvider } from "@/lib/cart-context";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: 5, error: null }),
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/account", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import TermsPage from "@/app/terms/page";
import PrivacyPage from "@/app/privacy/page";
import AboutPage from "@/app/account/about/page";
import HelpPage from "@/app/account/help/page";
import { SiteFooter } from "@/components/SiteFooter";
import { LoginForm } from "@/components/LoginForm";
import { LEGAL_ENTITY_LINE, LEGAL_LINKS } from "@/lib/legal-links";

const root = process.cwd();
const source = (doc: string) => readFileSync(path.join(root, "src/content/legal", `${doc}.md`), "utf8");

/** The markdown with its syntax stripped: what a reader should see, word for word. */
function plainText(md: string) {
  return md
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^#{1,2} /, "").replace(/^- /, ""))
    .join(" ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, "")
    .trim();
}
const squash = (s: string | null) => (s ?? "").replace(/\s+/g, "");

afterEach(cleanup);

describe.each([
  ["terms", TermsPage, "Terms of Use", "/privacy"],
  ["privacy", PrivacyPage, "Privacy Policy", "/terms"],
] as const)("/%s page", (doc, Page, title, otherHref) => {
  it("shows the title, effective date, company name and UEN", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    const article = screen.getByTestId(`legal-${doc}`);
    expect(article).toHaveTextContent("Effective 22 December 2026");
    expect(article).toHaveTextContent("KOPIE BOY");
    expect(article).toHaveTextContent("UEN 53535194A");
  });

  it("renders the owner's text word for word", () => {
    render(<Page />);
    expect(squash(screen.getByTestId(`legal-${doc}`).textContent)).toBe(plainText(source(doc)));
  });

  it("links to the other legal page", () => {
    render(<Page />);
    const nav = screen.getByRole("navigation", { name: "Legal" });
    expect(within(nav).getByRole("link")).toHaveAttribute("href", otherHref);
  });
});

describe("Terms → Privacy link", () => {
  it("the [Privacy Policy](/privacy) link in the terms points at /privacy", () => {
    render(<TermsPage />);
    const link = within(screen.getByTestId("legal-terms")).getByRole("link", { name: "Privacy Policy" });
    expect(link).toHaveAttribute("href", "/privacy");
  });
});

describe("Legal links", () => {
  it("every link resolves to a page in the app", () => {
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(["/terms", "/privacy"]);
    for (const { href } of LEGAL_LINKS) {
      expect(existsSync(path.join(root, "src/app", href, "page.tsx"))).toBe(true);
    }
  });

  it("About and Help link to /terms and /privacy in the same tab", async () => {
    for (const page of [<AboutPage key="about" />, await HelpPage()]) {
      render(<CartProvider>{page}</CartProvider>);
      const links = within(screen.getByTestId("legal-links"));
      expect(links.getByRole("link", { name: /Terms of Use/ })).toHaveAttribute("href", "/terms");
      expect(links.getByRole("link", { name: /Privacy Policy/ })).toHaveAttribute("href", "/privacy");
      expect(links.getByRole("link", { name: /Terms of Use/ })).not.toHaveAttribute("target");
      cleanup();
    }
  });
});

describe("Site footer", () => {
  it("names the business and links to both legal pages, with no GST or tax wording", () => {
    render(<SiteFooter />);
    const footer = screen.getByTestId("site-footer");
    expect(LEGAL_ENTITY_LINE).toBe("KOPIE BOY (UEN 53535194A), trading as Kopi Boy");
    expect(footer).toHaveTextContent(LEGAL_ENTITY_LINE);
    expect(within(footer).getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(within(footer).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(footer.textContent).not.toMatch(/GST|tax/i);
  });

  it("is in the root layout, so it shows on every page", () => {
    expect(readFileSync(path.join(root, "src/app/layout.tsx"), "utf8")).toContain("<SiteFooter />");
  });
});

describe("Sign-in consent line", () => {
  it("says the user agrees to the Terms of Use and Privacy Policy, linking both in the same tab", () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    const line = screen.getByText(/By continuing, you agree to our/);
    expect(line).toHaveTextContent("By continuing, you agree to our Terms of Use and Privacy Policy.");
    const terms = within(line).getByRole("link", { name: "Terms of Use" });
    const privacy = within(line).getByRole("link", { name: "Privacy Policy" });
    expect(terms).toHaveAttribute("href", "/terms");
    expect(privacy).toHaveAttribute("href", "/privacy");
    expect(terms).not.toHaveAttribute("target");
    expect(privacy).not.toHaveAttribute("target");
    expect(document.body).not.toHaveTextContent("for local food ordering and delivery");
  });
});
