"use client";

import { useRouter } from "next/navigation";
import { useNotifications } from "@/lib/notifications-context";
import { notificationHref } from "@/lib/notifications";

/**
 * Live toasts for notifications that arrive while the app is open. The
 * container is always mounted (an aria-live region has to exist *before* its
 * content changes for screen readers to announce it); each toast auto-dismisses
 * (see TOAST_DURATION_MS in the provider) and tapping one opens its order and
 * marks it read.
 */
export function NotificationToasts() {
  const router = useRouter();
  const { toasts, markRead, dismissToast } = useNotifications();

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] mx-auto flex max-w-sm flex-col gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))]"
    >
      {toasts.map((n) => {
        const href = notificationHref(n);
        return (
          <div
            key={n.id}
            data-testid="notification-toast"
            className="pointer-events-auto flex items-start gap-2 rounded-2xl bg-white p-3 shadow-lg"
            style={{ color: "var(--kb-ink)", borderLeft: "4px solid var(--kb-purple)" }}
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                void markRead(n.id);
                if (href) router.push(href);
              }}
            >
              <span className="block text-sm font-semibold">{n.title}</span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                {n.body}
              </span>
            </button>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(n.id)}
              className="rounded-full p-1"
              style={{ color: "var(--kb-ink-soft)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
