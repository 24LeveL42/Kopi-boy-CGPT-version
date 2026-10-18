import { describe, it, expect } from "vitest";
import { asapArrivalEstimate, groupSlotsByDay, scheduleSlots, validateScheduledFor } from "@/lib/delivery-time";

// 10:07 Singapore time.
const NOW = new Date("2026-10-18T02:07:00.000Z");

describe("scheduleSlots", () => {
  it("starts at the first :00/:30 at least 45 minutes ahead, every 30 minutes, up to 2 days out", () => {
    const slots = scheduleSlots(NOW);
    expect(slots[0].toISOString()).toBe("2026-10-18T03:00:00.000Z"); // 10:52 -> 11:00 SGT
    expect(slots[1].getTime() - slots[0].getTime()).toBe(30 * 60_000);
    expect(slots[slots.length - 1].toISOString()).toBe("2026-10-20T02:00:00.000Z"); // last slot within 48 h
    expect(slots).toHaveLength(95); // 03:00 on the 18th to 02:00 on the 20th: 47 h of half-hours, inclusive
  });

  it("lands exactly 45 minutes ahead when that is a slot boundary", () => {
    expect(scheduleSlots(new Date("2026-10-18T02:15:00.000Z"))[0].toISOString()).toBe("2026-10-18T03:00:00.000Z");
  });

  it("groups slots by Singapore day: Today, Tomorrow, then the date", () => {
    const groups = groupSlotsByDay(scheduleSlots(NOW), NOW);
    expect(groups.map((g) => g.day)).toEqual(["Today", "Tomorrow", expect.stringMatching(/20 Oct/)]);
    // Today ends at 23:30 SGT = 15:30Z.
    expect(groups[0].slots[groups[0].slots.length - 1].toISOString()).toBe("2026-10-18T15:30:00.000Z");
  });
});

describe("validateScheduledFor (server-side)", () => {
  it("treats empty as As soon as possible", () => {
    expect(validateScheduledFor(null, NOW)).toEqual({ ok: true, scheduledFor: null });
    expect(validateScheduledFor(undefined, NOW)).toEqual({ ok: true, scheduledFor: null });
    expect(validateScheduledFor("", NOW)).toEqual({ ok: true, scheduledFor: null });
  });

  it("accepts every slot the checkout offers", () => {
    for (const slot of scheduleSlots(NOW)) {
      expect(validateScheduledFor(slot.toISOString(), NOW)).toEqual({ ok: true, scheduledFor: slot.toISOString() });
    }
  });

  it("rejects a time under 45 minutes away, whatever the browser thought", () => {
    expect(validateScheduledFor("2026-10-18T02:30:00.000Z", NOW)).toMatchObject({ ok: false, message: expect.stringMatching(/45 minutes/) });
  });

  it("rejects a time more than 2 days away", () => {
    expect(validateScheduledFor("2026-10-20T02:30:00.000Z", NOW)).toMatchObject({ ok: false, message: expect.stringMatching(/2 days/) });
  });

  it("rejects off-slot times and junk", () => {
    for (const bad of ["2026-10-18T03:10:00.000Z", "2026-10-18T03:00:30.000Z", "tomorrow", 12345, {}]) {
      expect(validateScheduledFor(bad, NOW)).toMatchObject({ ok: false });
    }
  });
});

describe("asapArrivalEstimate", () => {
  const base = { scheduled_for: null, order_status: "placed", decided_at: null };

  it("says how long after acceptance while the kitchen hasn't accepted", () => {
    expect(asapArrivalEstimate(base, false)).toEqual({ kind: "after-accept", text: "About 25–40 min after the kitchen accepts" });
  });

  it("gives a Singapore-time window counted from acceptance", () => {
    const est = asapArrivalEstimate({ ...base, order_status: "accepted", decided_at: "2026-10-18T02:00:00.000Z" }, false);
    expect(est?.kind).toBe("window");
    expect(est?.text).toMatch(/10:25.*10:40/);
  });

  it("is null for scheduled, delivered and cancelled orders", () => {
    expect(asapArrivalEstimate({ ...base, scheduled_for: "2026-10-18T05:00:00.000Z" }, false)).toBeNull();
    expect(asapArrivalEstimate({ ...base, order_status: "accepted", decided_at: "2026-10-18T02:00:00.000Z" }, true)).toBeNull();
    expect(asapArrivalEstimate({ ...base, order_status: "cancelled" }, false)).toBeNull();
  });
});
