"use client";

import Link from "next/link";
import { useNotifications } from "@/lib/notifications-context";

/**
 * Bell + unread badge linking to the inbox. Rendered in the universal
 * PageChrome bar, so it's on every route; hidden until we know there's a
 * signed-in customer (no flicker for logged-out visitors).
 */
export function NotificationBell() {
  const { status, unreadCount } = useNotifications();
  if (status === "idle" || status === "signed-out") return null;

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  return (
    <Link
      href="/notifications"
      aria-label={label}
      className="relative flex items-center justify-center rounded-full p-2"
      style={{ color: "var(--kb-on-navy)" }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 003.4 0" />
      </svg>
      {unreadCount > 0 && (
        <span
          data-testid="notification-badge"
          className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
          style={{ background: "var(--kb-danger)" }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
