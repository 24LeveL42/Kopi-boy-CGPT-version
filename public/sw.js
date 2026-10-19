/* Kopi Boy — service worker. Shows order-update Web Push; no offline caching. */

// Bump on every change so installed phones pick up the new worker (it's also
// served no-store, see next.config.ts).
const SW_VERSION = "2026-10-19.1";

// Full-colour KB logo inside the notification, and the white-on-transparent
// KB that Android shows in the status bar (only its alpha is used). Same paths
// as NOTIFICATION_ICON / NOTIFICATION_BADGE in src/lib/order-push.ts.
const NOTIFICATION_ICON = "/brand/logo-icon.png";
const NOTIFICATION_BADGE = "/notification-badge.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  console.info("Kopi Boy service worker", SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// Only same-origin order pages (or home) are ever opened from a notification.
function safeUrl(url) {
  try {
    const target = new URL(url || "/", self.location.origin);
    if (target.origin !== self.location.origin) return "/";
    return /^\/orders\/[0-9a-f-]{36}$/i.test(target.pathname) ? target.pathname : "/";
  } catch {
    return "/";
  }
}

// A payload image may only be one of our own files.
function safeAsset(path, fallback) {
  return typeof path === "string" && /^\/(?!\/)[\w./-]+\.png$/.test(path) ? path : fallback;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Kopi Boy";
  // Always show something: browsers (iOS especially) revoke a subscription that
  // receives pushes without displaying them. `tag` keeps one notification per
  // order — a newer update replaces the older one instead of stacking.
  event.waitUntil(
    self.registration
      .showNotification(title, {
        body: data.body || "",
        icon: safeAsset(data.icon, NOTIFICATION_ICON),
        badge: safeAsset(data.badge, NOTIFICATION_BADGE),
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: safeUrl(data.url) },
      })
      .catch(() =>
        // A rejected option must not cost the customer the notification: retry bare.
        self.registration.showNotification(title, { body: data.body || "", data: { url: safeUrl(data.url) } })
      )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safeUrl(event.notification.data && event.notification.data.url), self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          try {
            if ("navigate" in client && (await client.navigate(target))) return;
          } catch {
            // navigate fails for a client this worker doesn't control yet
          }
          break;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
