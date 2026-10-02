import { describe, it, expect } from "vitest";
import {
  countUnread,
  formatRelativeTime,
  mergeNotifications,
  NOTIFICATION_LIMIT,
  notificationHref,
} from "@/lib/notifications";
import { makeNotification } from "./helpers/fake-supabase";

describe("mergeNotifications", () => {
  it("unions by id and sorts newest first", () => {
    const a = makeNotification({ id: "a", created_at: "2026-09-20T10:00:00.000Z" });
    const b = makeNotification({ id: "b", created_at: "2026-09-20T11:00:00.000Z" });
    const c = makeNotification({ id: "c", created_at: "2026-09-20T09:00:00.000Z" });
    expect(mergeNotifications([a, c], [b]).map((n) => n.id)).toEqual(["b", "a", "c"]);
  });

  it("de-duplicates a row that arrives both live and via fetch, incoming copy wins", () => {
    const unread = makeNotification({ id: "a", read_at: null });
    const read = makeNotification({ id: "a", read_at: "2026-09-20T10:05:00.000Z" });
    const merged = mergeNotifications([unread], [read]);
    expect(merged).toHaveLength(1);
    expect(merged[0].read_at).toBe("2026-09-20T10:05:00.000Z");
  });

  it("caps at NOTIFICATION_LIMIT keeping the newest", () => {
    const rows = Array.from({ length: NOTIFICATION_LIMIT + 10 }, (_, i) =>
      makeNotification({ id: `n-${i}`, created_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() })
    );
    const merged = mergeNotifications([], rows);
    expect(merged).toHaveLength(NOTIFICATION_LIMIT);
    expect(merged[0].id).toBe(`n-${NOTIFICATION_LIMIT + 9}`);
  });
});

describe("countUnread / notificationHref", () => {
  it("counts only rows with no read_at", () => {
    expect(
      countUnread([
        makeNotification({ id: "1", read_at: null }),
        makeNotification({ id: "2", read_at: "2026-09-20T10:00:00.000Z" }),
        makeNotification({ id: "3", read_at: null }),
      ])
    ).toBe(2);
  });

  it("links to the order, or nowhere when there is none", () => {
    expect(notificationHref({ url: "/orders/abc" })).toBe("/orders/abc");
    // The shared table's default url for order-less rows means "nowhere".
    expect(notificationHref({ url: "/" })).toBeNull();
    expect(notificationHref({ url: "" })).toBeNull();
    // Only same-site paths are ever followed.
    expect(notificationHref({ url: "https://evil.example.com/x" })).toBeNull();
    expect(notificationHref({ url: "//evil.example.com/x" })).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reads naturally at each scale", () => {
    expect(formatRelativeTime(ago(5_000), now)).toBe("Just now");
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe("2 d ago");
    expect(formatRelativeTime(ago(30 * 86_400_000), now)).toMatch(/\d{1,2} \w{3}/);
  });

  it("never goes negative for a timestamp slightly in the future (clock skew)", () => {
    expect(formatRelativeTime(new Date(now + 10_000).toISOString(), now)).toBe("Just now");
  });

  it("dates older items in Singapore time, not UTC", () => {
    // 20:11 UTC on 1 Sep is 04:11 SGT on 2 Sep.
    expect(formatRelativeTime("2026-09-01T20:11:00.000Z", now)).toMatch(/^2 Sept?$/);
  });

  it("returns empty string for garbage", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});
