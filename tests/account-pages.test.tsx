import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CartProvider } from "@/lib/cart-context";

const auth = vi.hoisted(() => ({
  user: { id: "customer-1", email: "a@example.com", user_metadata: {} } as unknown,
  // What public.payment_window_minutes() returns; null = the RPC fails.
  windowMinutes: 5 as number | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
    rpc: async () =>
      auth.windowMinutes === null ? { data: null, error: { message: "does not exist" } } : { data: auth.windowMinutes, error: null },
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
vi.mock("@/components/SupportMessageForm", () => ({ SupportMessageForm: () => <div data-testid="support-message-form" /> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/account", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import AccountPage from "@/app/account/page";
import PaymentMethodPage from "@/app/account/payment/page";
import AboutPage from "@/app/account/about/page";
import HelpPage from "@/app/account/help/page";
import { ORDER_PUSH_MESSAGES } from "@/lib/order-push";

const inApp = (ui: React.ReactNode) => render(<CartProvider>{ui}</CartProvider>);
afterEach(() => {
  cleanup();
  auth.windowMinutes = 5;
});

describe("Profile", () => {
  it("links every row to a real page — none are greyed out", async () => {
    inApp(await AccountPage());
    for (const [name, href] of [
      ["Notifications", "/account/notifications"],
      ["Payment Method", "/account/payment"],
      ["Help & Support", "/account/help"],
      ["About Kopi Boy", "/account/about"],
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
    }
    expect(document.querySelector(".is-disabled")).toBeNull();
  });
});

describe("Payment method", () => {
  it("explains PayNow-to-the-kitchen, 0% commission and that nothing is stored", async () => {
    inApp(await PaymentMethodPage());
    const page = document.body;
    expect(page).toHaveTextContent("The cook accepts");
    expect(page).toHaveTextContent("Send your proof of payment");
    expect(page).toHaveTextContent("never holds your money");
    expect(page).toHaveTextContent("0% commission");
    expect(page).toHaveTextContent("No cards or bank details stored");
  });

  it("gives the time to pay from the database setting", async () => {
    auth.windowMinutes = 7;
    inApp(await PaymentMethodPage());
    expect(document.body).toHaveTextContent("within 7 minutes of the cook accepting, or the order is cancelled automatically");
  });

  it("falls back to 'within a few minutes' when the setting can't be read", async () => {
    auth.windowMinutes = null;
    inApp(await PaymentMethodPage());
    expect(document.body).toHaveTextContent("within a few minutes of the cook accepting");
  });
});

describe("About", () => {
  it("describes Kopi Boy as a connector with 0% commission and riders paid by the kitchen", () => {
    inApp(<AboutPage />);
    expect(document.body).toHaveTextContent("connects home cooks, hawkers and small food businesses");
    expect(document.body).toHaveTextContent("0% commission");
    expect(document.body).toHaveTextContent("The kitchen pays the rider the delivery fee directly.");
  });
});

describe("Help & Support", () => {
  it("has the FAQ topics and the message form for a signed-in customer", async () => {
    inApp(await HelpPage());
    const faq = screen.getByTestId("help-faq");
    for (const topic of ["place an order", "PayNow", "delivery fee an estimate", "cancel", "notifications", "saved addresses"]) {
      expect(within(faq).getByText(new RegExp(topic, "i"), { selector: "summary span" })).toBeInTheDocument();
    }
    expect(screen.getByTestId("support-message-form")).toBeInTheDocument();
  });

  it("gives the PayNow time limit from the database setting", async () => {
    inApp(await HelpPage());
    expect(screen.getByTestId("help-faq")).toHaveTextContent("on the order page within 5 minutes");
    expect(screen.getByTestId("help-faq").textContent).not.toMatch(/15 min/);
  });

  it("asks a signed-out visitor to sign in instead of showing the form", async () => {
    auth.user = null;
    inApp(await HelpPage());
    expect(screen.queryByTestId("support-message-form")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});

describe("Roles customers see", () => {
  // Kopi Boy has cooks and riders only; there is no picker / pick-up partner role.
  const PICKER = /pickers?|pick-?up partners?/i;

  it("never mentions pickers on Profile, Payment, About or Help", async () => {
    for (const page of [await AccountPage(), await PaymentMethodPage(), <AboutPage key="about" />, await HelpPage()]) {
      inApp(page);
      expect(document.body.textContent).not.toMatch(PICKER);
      cleanup();
    }
  });

  it("never mentions pickers in push notifications", () => {
    for (const { title, body } of Object.values(ORDER_PUSH_MESSAGES)) {
      expect(`${title} ${body}`).not.toMatch(PICKER);
    }
  });
});
