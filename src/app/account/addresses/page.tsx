import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadSavedAddresses } from "@/lib/address-store";
import { AddressBook } from "@/components/AddressBook";
import { BottomNav } from "@/components/BottomNav";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `My addresses — ${BRAND_NAME}`,
};

export default async function AddressesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { addresses, failed } = user ? await loadSavedAddresses(supabase, user.id) : { addresses: [], failed: false };

  return (
    <div className="kb-app-shell min-h-screen pb-28">
      <main className="mx-auto max-w-md px-4 py-6 sm:px-6">
        {user ? (
          <AddressBook addresses={addresses} loadFailed={failed} />
        ) : (
          <div className="kb-signin-card">
            <p className="font-extrabold">Sign in to manage your addresses</p>
            <p className="mt-1 text-sm text-slate-500">Saved addresses make checkout one tap.</p>
            <Link href="/login" className="kb-primary-button mt-4 w-full">
              Sign in
            </Link>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
