/**
 * "When" at checkout (As soon as possible, or a scheduled slot) and the
 * arrival estimate on the order page. Pure functions, shared by the checkout
 * UI and placeOrder(): the browser only uses them to list slots, the server
 * re-checks the chosen time with its own clock, so a wrong or tampered
 * browser clock can't get past these rules.
 *
 * Singapore is UTC+8 all year (no daylight saving), so a :00/:30 boundary in
 * UTC is also a :00/:30 boundary in Singapore time.
 */

export const SLOT_MINUTES = 30;
export const MIN_LEAD_MINUTES = 45;
export const MAX_AHEAD_DAYS = 2;

const MINUTE_MS = 60_000;
const SLOT_MS = SLOT_MINUTES * MINUTE_MS;
const MIN_LEAD_MS = MIN_LEAD_MINUTES * MINUTE_MS;
const MAX_AHEAD_MS = MAX_AHEAD_DAYS * 24 * 60 * MINUTE_MS;

/** Same range the checkout shows for Normal delivery, counted from when the kitchen accepts. */
export const ASAP_ETA_MINUTES = { min: 25, max: 40 } as const;

const SG_TIME_ZONE = "Asia/Singapore";

/** Every slot a customer can pick right now: each :00/:30 at least 45 minutes ahead, up to 2 days out. */
export function scheduleSlots(now: Date): Date[] {
  const first = Math.ceil((now.getTime() + MIN_LEAD_MS) / SLOT_MS) * SLOT_MS;
  const last = now.getTime() + MAX_AHEAD_MS;
  const slots: Date[] = [];
  for (let t = first; t <= last; t += SLOT_MS) slots.push(new Date(t));
  return slots;
}

export type ScheduleCheck = { ok: true; scheduledFor: string | null } | { ok: false; message: string };

/**
 * Server-side check of the chosen time. Empty means As soon as possible.
 * Anything else must be one of scheduleSlots(now) for the server's `now`.
 */
export function validateScheduledFor(value: unknown, now: Date): ScheduleCheck {
  if (value == null || value === "") return { ok: true, scheduledFor: null };
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || time % SLOT_MS !== 0) {
    return { ok: false, message: "Please pick a delivery time from the list." };
  }
  if (time < now.getTime() + MIN_LEAD_MS) {
    return { ok: false, message: `That time is too soon now. Please pick a time at least ${MIN_LEAD_MINUTES} minutes from now.` };
  }
  if (time > now.getTime() + MAX_AHEAD_MS) {
    return { ok: false, message: `Please pick a time within the next ${MAX_AHEAD_DAYS} days.` };
  }
  return { ok: true, scheduledFor: new Date(time).toISOString() };
}

function sgDateKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: SG_TIME_ZONE });
}

export function formatSgTime(date: Date) {
  return date.toLocaleTimeString("en-SG", { timeZone: SG_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

/** "Today", "Tomorrow", or "Mon 20 Oct" — the Singapore date of `date`, seen from `now`. */
export function sgDayLabel(date: Date, now: Date) {
  const key = sgDateKey(date);
  if (key === sgDateKey(now)) return "Today";
  if (key === sgDateKey(new Date(now.getTime() + 24 * 60 * MINUTE_MS))) return "Tomorrow";
  return date.toLocaleDateString("en-SG", { timeZone: SG_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
}

/** Slots grouped by Singapore day, for the checkout's time picker. */
export function groupSlotsByDay(slots: Date[], now: Date): { day: string; slots: Date[] }[] {
  const groups: { day: string; slots: Date[] }[] = [];
  for (const slot of slots) {
    const day = sgDayLabel(slot, now);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.slots.push(slot);
    else groups.push({ day, slots: [slot] });
  }
  return groups;
}

export type ArrivalEstimate =
  | { kind: "after-accept"; text: string }
  | { kind: "window"; text: string };

/**
 * Rough arrival time for an As-soon-as-possible order that's still on its
 * way. Before the kitchen accepts there's no clock to count from, so it says
 * how long after acceptance. Null for scheduled, finished or failed orders.
 */
export function asapArrivalEstimate(order: {
  scheduled_for?: string | null;
  order_status: string;
  decided_at: string | null;
}, delivered: boolean): ArrivalEstimate | null {
  if (order.scheduled_for || delivered) return null;
  const { min, max } = ASAP_ETA_MINUTES;
  if (order.order_status === "placed") {
    return { kind: "after-accept", text: `About ${min}–${max} min after the kitchen accepts` };
  }
  if (order.order_status !== "accepted" || !order.decided_at) return null;
  const accepted = Date.parse(order.decided_at);
  if (!Number.isFinite(accepted)) return null;
  const from = formatSgTime(new Date(accepted + min * MINUTE_MS));
  const to = formatSgTime(new Date(accepted + max * MINUTE_MS));
  return { kind: "window", text: `${from} – ${to}` };
}
