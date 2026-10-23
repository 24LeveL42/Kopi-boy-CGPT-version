"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { NotificationBell } from "./NotificationBell";
import { CartButton } from "./CartButton";
import { BRAND_NAME } from "@/lib/brand";

export function PageChrome() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/" || pathname.startsWith("/merchant/")) return null;

  const title = pathname.startsWith("/merchant/") ? "Kitchen" : pathname.startsWith("/orders/") ? "Order details" : pathname === "/orders" ? "My orders" : pathname === "/cart" ? "Your cart" : pathname === "/account" ? "My profile" : pathname === "/account/addresses" ? "My addresses" : pathname === "/account/notifications" ? "Notifications" : pathname === "/account/payment" ? "Payment method" : pathname === "/account/help" ? "Help & support" : pathname === "/account/about" ? `About ${BRAND_NAME}` : pathname === "/notifications" ? "Notifications" : pathname === "/login" ? "Sign in" : BRAND_NAME;

  return (
    <header className="kb-page-chrome">
      <button type="button" onClick={() => router.back()} aria-label="Go back" className="kb-icon-button">
        <BackIcon />
      </button>
      <Link href="/" aria-label={`${BRAND_NAME} home`} className="kb-chrome-brand">
        <Image src="/brand/logo-icon.png" alt={BRAND_NAME} width={34} height={34} className="h-8 w-8 object-contain" />
        <span>{title}</span>
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />
        <CartButton />
      </div>
    </header>
  );
}

function BackIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>;
}
