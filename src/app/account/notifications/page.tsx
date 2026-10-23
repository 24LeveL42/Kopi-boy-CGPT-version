import type { Metadata } from "next";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { PushToggle } from "@/components/PushNotifications";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Notification settings — ${BRAND_NAME}`,
};

/** Push on/off for this device. The in-app inbox stays at /notifications (the bell). */
export default function NotificationSettingsPage() {
  return (
    <div className="kb-app-shell min-h-screen pb-28">
      <main className="mx-auto max-w-md px-4 py-6 sm:px-6">
        <div className="kb-page-title">
          <div>
            <p className="kb-eyebrow">SETTINGS</p>
            <h1>Notifications</h1>
            <p>Hear about your order even with the app closed.</p>
          </div>
        </div>
        <PushToggle />
        <p className="mt-3 px-1 text-xs leading-5 text-slate-500">
          This setting is for this phone or browser only. You&apos;ll still see every update in your{" "}
          <Link href="/notifications" className="font-bold text-purple-700">
            notification inbox
          </Link>
          .
        </p>
      </main>
      <BottomNav />
    </div>
  );
}
