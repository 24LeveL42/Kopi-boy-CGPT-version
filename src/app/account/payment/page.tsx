import type { Metadata } from "next";
import { BottomNav } from "@/components/BottomNav";
import { createClient } from "@/lib/supabase/server";
import { getPaymentWindowMinutes, paymentWindowText } from "@/lib/payment-proof";

export const metadata: Metadata = {
  title: "Payment method — Kopi Boy",
};

/** paymentWindow: "within 5 minutes", from the database setting (public.payment_window_minutes()). */
const steps = (paymentWindow: string) => [
  { title: "Place your order", body: "Nothing is charged when you order." },
  { title: "The cook accepts", body: "Your order page then shows the kitchen's PayNow number or UEN and the amount to pay." },
  { title: "Pay the kitchen by PayNow", body: "Use your own banking app to pay the kitchen directly." },
  {
    title: "Send your proof of payment",
    body: `Upload a screenshot of the PayNow transfer on your order page ${paymentWindow} of the cook accepting, or the order is cancelled automatically. The cook checks it and starts preparing your food.`,
  },
];

/** Informational only: there's nothing to set up, and nothing about the customer's payment is stored. */
export default async function PaymentMethodPage() {
  const paymentWindowMinutes = await getPaymentWindowMinutes(await createClient());
  return (
    <div className="kb-app-shell min-h-screen pb-28">
      <main className="mx-auto max-w-md px-4 py-6 sm:px-6">
        <div className="kb-page-title">
          <div>
            <p className="kb-eyebrow">PAYMENT</p>
            <h1>Payment method</h1>
            <p>You pay the kitchen directly by PayNow.</p>
          </div>
        </div>

        <section className="kb-cart-card mt-5">
          <p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">How paying works</p>
          <ol className="mt-3 space-y-3">
            {steps(paymentWindowText(paymentWindowMinutes)).map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-purple-100 text-xs font-black text-purple-700">{i + 1}</span>
                <div>
                  <p className="text-sm font-bold text-slate-900">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="kb-no-fee mt-4">
          <span>🏷️</span>
          <div>
            <b>0% commission</b>
            <small>Kopi Boy never holds your money. Your payment goes straight to the kitchen, and Kopi Boy takes no commission on your food.</small>
          </div>
        </div>

        <section className="kb-cart-card mt-4">
          <p className="text-sm font-bold text-slate-900">No cards or bank details stored</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            There&apos;s nothing to add here. Kopi Boy doesn&apos;t ask for or keep your card or bank details, and you pay from your own banking app.
          </p>
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
