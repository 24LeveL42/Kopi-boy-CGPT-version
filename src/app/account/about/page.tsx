import type { Metadata } from "next";
import { BottomNav } from "@/components/BottomNav";
import { LegalLinks } from "@/components/LegalLinks";

export const metadata: Metadata = {
  title: "About Kopi Boy",
};

export default function AboutPage() {
  return (
    <div className="kb-app-shell min-h-screen pb-28">
      <main className="mx-auto max-w-md px-4 py-6 sm:px-6">
        <div className="kb-page-title">
          <div>
            <p className="kb-eyebrow">ABOUT</p>
            <h1>About Kopi Boy</h1>
            <p>From neighbourhoods to you.</p>
          </div>
        </div>

        <section className="kb-cart-card mt-5 space-y-4">
          <div>
            <p className="text-sm font-bold text-slate-900">A connector for local kitchens</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Kopi Boy connects home cooks, hawkers and small food businesses with customers nearby. The kitchens cook and sell their own food. Kopi Boy helps you find them and place your order.
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">0% commission</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Kopi Boy takes no commission on your food. You pay the kitchen directly by PayNow, and Kopi Boy never holds your money.
            </p>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">Riders</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              The delivery fee goes to the rider. The kitchen pays the rider the delivery fee directly.
            </p>
          </div>
        </section>

        <LegalLinks />
      </main>
      <BottomNav />
    </div>
  );
}
