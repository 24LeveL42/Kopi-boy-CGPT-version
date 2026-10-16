/* Kopi Boy — service worker. Shows order-update Web Push; no offline caching. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
        icon: "/icons/icon-192.png",
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
