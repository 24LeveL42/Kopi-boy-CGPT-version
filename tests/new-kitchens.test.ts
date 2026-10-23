import { describe, it, expect } from "vitest";
import { NEW_KITCHEN_DAYS, isNewKitchen, selectNewKitchens } from "@/lib/new-kitchens";
import { loadLiveSince } from "@/lib/kitchens";
import type { Merchant } from "@/lib/types";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function kitchen(id: string, overrides: Partial<Merchant> = {}): Merchant {
  return {
    id, name: id, category: "hawker", cuisine: "Chinese", area: null, blurb: "", rating: 0, ratingCount: 0, etaMinutes: 30, distanceKm: null,
    latitude: null, longitude: null, priceFrom: 5, heroImage: "/categories/hawkers.jpg", avatarImage: "/categories/hawkers.jpg", cuisineType: "chinese",
    menuHighlights: [], isNew: true, liveSince: daysAgo(1), ...overrides,
  };
}

describe("isNewKitchen — the 14-day NEW rule", () => {
  it("uses one 14-day constant", () => {
    expect(NEW_KITCHEN_DAYS).toBe(14);
  });

  it("is new inside the first 14 days and not after", () => {
    expect(isNewKitchen(daysAgo(0), NOW)).toBe(true);
    expect(isNewKitchen(daysAgo(13.9), NOW)).toBe(true);
    expect(isNewKitchen(daysAgo(14), NOW)).toBe(false);
    expect(isNewKitchen(daysAgo(200), NOW)).toBe(false);
  });

  it("is never new without a readable date", () => {
    for (const v of [null, undefined, "", "not a date"]) expect(isNewKitchen(v, NOW)).toBe(false);
  });
});

describe("selectNewKitchens — New Kitchens Near You", () => {
  it("keeps only new, unblocked kitchens, newest first", () => {
    const list = [kitchen("old", { isNew: false }), kitchen("a", { liveSince: daysAgo(5) }), kitchen("b", { liveSince: daysAgo(1) }), kitchen("blocked", { isBlocked: true })];
    expect(selectNewKitchens(list, { nearbyIds: null }).map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("filters to nearby kitchens when the location is known, and drops excluded ones", () => {
    const list = [kitchen("near"), kitchen("far"), kitchen("popular")];
    const picked = selectNewKitchens(list, { nearbyIds: new Set(["near", "popular"]), excludeIds: new Set(["popular"]) });
    expect(picked.map((m) => m.id)).toEqual(["near"]);
  });

  it("shows at most 10", () => {
    const list = Array.from({ length: 15 }, (_, i) => kitchen(`k${i}`));
    expect(selectNewKitchens(list, { nearbyIds: null })).toHaveLength(10);
  });
});

describe("loadLiveSince — where the go-live date comes from", () => {
  type Result = { data: unknown; error: { code: string; message: string } | null };
  function fakeSupabase(answer: (columns: string) => Result) {
    const asked: string[] = [];
    const supabase = {
      from: () => ({
        select: (columns: string) => {
          asked.push(columns);
          return { in: () => ({ returns: async () => answer(columns) }) };
        },
      }),
    };
    return { supabase: supabase as never, asked };
  }

  it("prefers live_since, falling back to created_at per kitchen", async () => {
    const { supabase } = fakeSupabase(() => ({ data: [{ id: "a", live_since: "2026-10-20", created_at: "2026-01-01" }, { id: "b", live_since: null, created_at: "2026-10-01" }], error: null }));
    const since = await loadLiveSince(supabase, ["a", "b"]);
    expect(since.get("a")).toBe("2026-10-20");
    expect(since.get("b")).toBe("2026-10-01");
  });

  it("uses created_at when the live_since column doesn't exist yet", async () => {
    const { supabase, asked } = fakeSupabase((columns) =>
      columns.includes("live_since") ? { data: null, error: { code: "42703", message: "column kitchens.live_since does not exist" } } : { data: [{ id: "a", created_at: "2026-10-20" }], error: null }
    );
    const since = await loadLiveSince(supabase, ["a"]);
    expect(asked).toEqual(["id, live_since, created_at", "id, created_at"]);
    expect(since.get("a")).toBe("2026-10-20");
  });

  it("treats an unreadable date (e.g. permission denied) as no dates, so nothing is NEW", async () => {
    const { supabase, asked } = fakeSupabase(() => ({ data: null, error: { code: "42501", message: "permission denied for table kitchens" } }));
    const since = await loadLiveSince(supabase, ["a"]);
    expect(since.size).toBe(0);
    expect(asked).toHaveLength(1);
  });
});
