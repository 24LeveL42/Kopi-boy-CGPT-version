import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/BottomNav";
import { LegalLinks } from "@/components/LegalLinks";
import { SupportMessageForm } from "@/components/SupportMessageForm";
import { ASAP_ETA_MINUTES, MIN_LEAD_MINUTES, MAX_AHEAD_DAYS } from "@/lib/delivery-time";
import { MAX_ADDRESSES } from "@/lib/addresses";
import { getPaymentWindowMinutes, paymentWindowText } from "@/lib/payment-proof";

export const metadata: Metadata = {
  title: "Help & support — Kopi Boy",
};

/** paymentWindow: "within 5 minutes", from the database setting (public.payment_window_minutes()). */
const faq = (paymentWindow: string): { q: string; a: string }[] => [
  {
    q: "How do I place an order?",
    a: `Add dishes from one kitchen to your cart, then tap Proceed to Checkout. Choose where to deliver, Normal or Express, and when: as soon as possible, or a time at least ${MIN_LEAD_MINUTES} minutes ahead within the next ${MAX_AHEAD_DAYS} days. Tap Confirm Order and the kitchen will accept or decline it.`,
  },
  {
    q: "How do I pay by PayNow?",
    a: `Once the cook accepts, your order page shows the kitchen's PayNow number or UEN and the total. Pay the kitchen from your banking app and upload a screenshot of the transfer on the order page ${paymentWindow}. If no proof arrives in time, the order is cancelled automatically. Kopi Boy never holds your money.`,
  },
  {
    q: "Why is the delivery fee an estimate?",
    a: "It's worked out from the distance between the kitchen and your postal code, and whether you chose Normal or Express. It's an estimate until the cook and rider confirm it.",
  },
  {
    q: "How long will delivery take?",
    a: `For an as-soon-as-possible order, your order page shows an estimated arrival of about ${ASAP_ETA_MINUTES.min}–${ASAP_ETA_MINUTES.max} minutes after the kitchen accepts. It's only an estimate.`,
  },
  {
    q: "Can I cancel my order?",
    a: "Yes, while it's still waiting for the kitchen to accept: tap Cancel order on the order page. After the kitchen accepts, use Report an issue on the order page to contact us.",
  },
  {
    q: "How do I get notifications?",
    a: "Go to Profile, then Notifications, and switch on order notifications. On iPhone, first add Kopi Boy to your Home Screen (Share, then Add to Home Screen) and open it from there.",
  },
  {
    q: "How do saved addresses work?",
    a: `You can save up to ${MAX_ADDRESSES} addresses in Profile, then My Addresses, or tick Save this address at checkout. Your default address is picked for you at checkout, and you can still choose another one.`,
  },
];

export default async function HelpPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    paymentWindowMinutes,
  ] = await Promise.all([supabase.auth.getUser(), getPaymentWindowMinutes(supabase)]);

  return (
    <div className="kb-app-shell min-h-screen pb-28">
      <main className="mx-auto max-w-md px-4 py-6 sm:px-6">
        <div className="kb-page-title">
          <div>
            <p className="kb-eyebrow">SUPPORT</p>
            <h1>Help &amp; Support</h1>
            <p>Answers to common questions, or send us a message.</p>
          </div>
        </div>

        <section className="kb-profile-menu mt-5" data-testid="help-faq">
          {faq(paymentWindowText(paymentWindowMinutes)).map((item) => (
            <details key={item.q} className="group border-b border-[#f0eef3] last:border-b-0">
              <summary className="kb-profile-link cursor-pointer list-none border-b-0">
                <span>{item.q}</span>
                <span className="ml-auto text-slate-300 transition group-open:rotate-90">›</span>
              </summary>
              <p className="px-4 pb-4 text-xs leading-5 text-slate-500">{item.a}</p>
            </details>
          ))}
        </section>

        {user ? (
          <SupportMessageForm userId={user.id} />
        ) : (
          <div className="kb-signin-card mt-4">
            <p className="font-extrabold">Message Kopi Boy</p>
            <p className="mt-1 text-sm text-slate-500">Sign in to send us a message and see our replies.</p>
            <Link href="/login" className="kb-primary-button mt-4 w-full">
              Sign in
            </Link>
          </div>
        )}

        <LegalLinks />
      </main>
      <BottomNav />
    </div>
  );
}
