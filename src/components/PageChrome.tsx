"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotificationBell } from "./NotificationBell";
import { CartButton } from "./CartButton";

/**
 * Universal Back + Home buttons, the cart, and the notifications bell (once
 * signed in), rendered once in the root layout so every route gets them for free —
 * matches the same top-of-shell placement the Partner app uses for its own
 * persistent nav.
 */
export function PageChrome() {
  const router = useRouter();

  return (
    <div className="flex items-center gap-1 px-3 py-2" style={{ background: "var(--kb-navy)" }}>
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Go back"
        className="flex items-center justify-center rounded-full p-2"
        style={{ color: "var(--kb-on-navy)" }}
      >
        <BackIcon />
      </button>
      <Link href="/" aria-label="Home" className="flex items-center justify-center rounded-full p-2" style={{ color: "var(--kb-on-navy)" }}>
        <HomeIcon />
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />
        <CartButton />
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9" />
    </svg>
  );
}
