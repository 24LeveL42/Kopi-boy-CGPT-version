// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { NOTIFICATION_BADGE, NOTIFICATION_ICON, buildOrderPushPayload } from "@/lib/order-push";

const ORDER_ID = "6f1c2b9e-1d2a-4c3b-9a8f-0e1d2c3b4a59";
const SW_SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const publicFile = (path: string) => new URL(`../public${path}`, import.meta.url);

/** Loads public/sw.js into a bare worker-like scope and returns its listeners. */
function loadServiceWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn<(title: string, options: Record<string, unknown>) => Promise<void>>(async () => undefined);
  const self = {
    location: { origin: "https://kopiboy.example" },
    registration: { showNotification },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => []), openWindow: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
  };
  runInNewContext(SW_SOURCE, { self, URL });
  return { listeners, showNotification };
}

async function push(data: unknown) {
  const { listeners, showNotification } = loadServiceWorker();
  let pending: Promise<unknown> = Promise.resolve();
  listeners.push({
    data: { json: () => data },
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  await pending;
  return showNotification.mock.calls[0];
}

describe("service worker push notification", () => {
  it("shows the full-colour KB icon and the monochrome Android badge from the payload", async () => {
    const [title, options] = await push(buildOrderPushPayload("payment_received", ORDER_ID));
    expect(title).toBe("Payment received");
    expect(options).toMatchObject({
      icon: "/brand/logo-icon.png",
      badge: "/notification-badge.png",
      tag: `order-${ORDER_ID}`,
      data: { url: `/orders/${ORDER_ID}` },
    });
  });

  it("falls back to the KB icon and badge for an older payload without them", async () => {
    const [, options] = await push({ title: "Order delivered", body: "Enjoy!", url: `/orders/${ORDER_ID}` });
    expect(options).toMatchObject({ icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE });
  });

  it("ignores images that aren't our own files", async () => {
    const [, options] = await push({ title: "x", icon: "https://evil.example/a.png", badge: "//evil.example/b.png" });
    expect(options).toMatchObject({ icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE });
  });

  it("uses the same image paths as the server payload", () => {
    expect(SW_SOURCE).toContain(`const NOTIFICATION_ICON = "${NOTIFICATION_ICON}";`);
    expect(SW_SOURCE).toContain(`const NOTIFICATION_BADGE = "${NOTIFICATION_BADGE}";`);
  });

  it("carries a version so changes reach installed phones", () => {
    expect(SW_SOURCE).toMatch(/const SW_VERSION = "[^"]+";/);
  });
});

describe("notification images", () => {
  it("has the full-colour icon in public/", async () => {
    const meta = await sharp(readFileSync(publicFile(NOTIFICATION_ICON))).metadata();
    expect(meta.format).toBe("png");
  });

  it("has a 96x96 badge that is pure white on a transparent background", async () => {
    const { data, info } = await sharp(readFileSync(publicFile(NOTIFICATION_BADGE)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([96, 96]);

    let opaque = 0;
    let transparent = 0;
    let coloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent++;
      else opaque++;
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) coloured++;
    }
    expect(coloured).toBe(0);
    // No solid square: corners are clear and a real share of the canvas is transparent.
    const corner = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect([corner(0, 0), corner(95, 0), corner(0, 95), corner(95, 95)]).toEqual([0, 0, 0, 0]);
    expect(transparent).toBeGreaterThan(data.length / 4 / 3);
    expect(opaque).toBeGreaterThan(data.length / 4 / 4);
  });
});
