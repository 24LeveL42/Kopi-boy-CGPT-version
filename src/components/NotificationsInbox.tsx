"use client";

import { useTransition } from "react";
import Link from "next/link";
import { LoadingStatus, Skeleton } from "@/components/Skeleton";
import { Spinner } from "@/components/Spinner";
import { useNotifications } from "@/lib/notifications-context";
import { formatRelativeTime, notificationHref, type NotificationRow } from "@/lib/notifications";

/**
 * The /notifications inbox. Reads the same live list as the bell and toasts
 * (see NotificationsProvider), so a new notification appears here the moment
 * it's inserted — no refresh, no polling.
 */
export function NotificationsInbox() {
  const { status, notifications, unreadCount, markRead, markAllRead, reload } = useNotifications();
  // A retry leaves status at "error" until it succeeds, so the button carries its own pending state.
  const [retrying, startRetry] = useTransition();

  return (
    <div className="kb-app-shell min-h-screen pb-28">
      <div className="mx-auto max-w-md px-4 py-6 sm:px-6">
        <div className="kb-page-title"><div><p className="kb-eyebrow">STAY IN THE LOOP</p><h1>Notifications</h1><p>Order updates and important Kopi Boy messages.</p></div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="kb-outline-button"
            >
              Mark all as read
            </button>
          )}
        </div>

        {(status === "idle" || status === "loading") && (
          <div className="mt-5 space-y-2">
            <LoadingStatus label="Loading your notifications…" />
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-start gap-2 rounded-2xl bg-white p-3 shadow-sm">
                <Skeleton tone="card" className="mt-1.5 h-2 w-2 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton tone="card" className="h-4 w-2/3" />
                  <Skeleton tone="card" className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {status === "signed-out" && (
          <div className="kb-signin-card mt-5">
            <p style={{ color: "var(--kb-ink-soft)" }}>Sign in to see updates about your orders.</p>
            <Link
              href="/login"
              className="mt-4 inline-block w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
            >
              Sign in
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="kb-signin-card mt-5">
            <p style={{ color: "var(--kb-danger)" }}>Couldn&apos;t load your notifications.</p>
            <button
              type="button"
              onClick={() => startRetry(reload)}
              disabled={retrying}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: "var(--kb-cream)", color: "var(--kb-ink)" }}
            >
              {retrying && <Spinner />}
              {retrying ? "Trying again…" : "Try again"}
            </button>
          </div>
        )}

        {status === "ready" && notifications.length === 0 && (
          <div className="kb-signin-card mt-5">
            <p className="font-semibold">Nothing yet</p>
            <p className="mt-1 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              Updates about your orders — accepted, ready, rider on the way, delivered — will show up here.
            </p>
          </div>
        )}

        {status === "ready" && notifications.length > 0 && (
          <ul className="mt-5 space-y-2">
            {notifications.map((n) => (
              <li key={n.id}>
                <NotificationItem notification={n} onOpen={() => void markRead(n.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotificationItem({ notification: n, onOpen }: { notification: NotificationRow; onOpen: () => void }) {
  const href = notificationHref(n);
  const unread = !n.read_at;
  const content = (
    <>
      <span
        aria-hidden="true"
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ background: unread ? "var(--kb-purple)" : "transparent" }}
      />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`text-sm ${unread ? "font-bold" : "font-medium"}`}>{n.title}</span>
          <span className="shrink-0 text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
            {formatRelativeTime(n.created_at)}
          </span>
        </span>
        <span className="mt-0.5 block text-xs" style={{ color: "var(--kb-ink-soft)" }}>
          {n.body}
        </span>
        {unread && <span className="sr-only">Unread</span>}
      </span>
    </>
  );

  const className = "kb-notification-card";
  const style = { color: "var(--kb-ink)", opacity: unread ? 1 : 0.8 };

  return href ? (
    <Link href={href} onClick={onOpen} className={className} style={style} data-testid="notification-item">
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={className} style={style} data-testid="notification-item">
      {content}
    </button>
  );
}
