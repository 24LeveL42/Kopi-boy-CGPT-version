/**
 * Order-update Web Push: which events send a push, and what it says.
 *
 * The events are decided in the database (docs/supabase-customer-push.sql —
 * the triggers on orders / delivery_requests — plus the Partner app's
 * pickup trigger for order_picked_up) and POSTed to
 * /api/push/order-update, which maps them to the wording below. The payload is
 * deliberately generic: no kitchen name, address, phone, amount or PayNow
 * details — only a short title, one line, and the order's own page.
 */

export const ORDER_PUSH_EVENTS = [
  "order_accepted",
  "order_cancelled",
  "payment_received",
  "payment_not_received",
  "rider_on_the_way",
  "order_picked_up",
  "order_delivered",
] as const;

export type OrderPushEvent = (typeof ORDER_PUSH_EVENTS)[number];

export const ORDER_PUSH_MESSAGES: Record<OrderPushEvent, { title: string; body: string }> = {
  order_accepted: {
    title: "Order accepted",
    body: "Your order was accepted. Pay now and send your proof within 15 minutes.",
  },
  order_cancelled: { title: "Order cancelled", body: "Your order was cancelled." },
  payment_received: { title: "Payment received", body: "Payment received. Your food is being prepared." },
  payment_not_received: {
    title: "Payment not received",
    body: "Your payment wasn't received. Please check and send your proof again.",
  },
  // delivery_requests.status = 'accepted': a rider took the job and is heading to the kitchen.
  rider_on_the_way: { title: "Rider on the way", body: "A rider is on the way to pick up your order." },
  // Sent by the Partner app when the rider marks the food collected
  // (delivery_requests.picked_up_at; status stays 'accepted'). ref = rider.
  order_picked_up: {
    title: "Your food is on the way",
    body: "Your rider has collected your food and is on the way to deliver it.",
  },
  order_delivered: { title: "Order delivered", body: "Your order was delivered. Enjoy!" },
};

/** Full-colour KB logo shown inside the notification. public/sw.js falls back to the same paths. */
export const NOTIFICATION_ICON = "/brand/logo-icon.png";
/**
 * Android status-bar icon: a white KB shape on transparent (only the alpha is
 * used). Without it Android shows a generic bell.
 */
export const NOTIFICATION_BADGE = "/notification-badge.png";

export interface OrderPushPayload {
  title: string;
  body: string;
  url: string;
  /** One notification per order on the device: a newer update replaces the older one. */
  tag: string;
  icon: string;
  badge: string;
}

export function isOrderPushEvent(value: unknown): value is OrderPushEvent {
  return typeof value === "string" && (ORDER_PUSH_EVENTS as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** The push for an event, or null when the event isn't one that sends a push. */
export function buildOrderPushPayload(event: unknown, orderId: string): OrderPushPayload | null {
  if (!isOrderPushEvent(event) || !isUuid(orderId)) return null;
  const { title, body } = ORDER_PUSH_MESSAGES[event];
  return {
    title,
    body,
    url: `/orders/${orderId}`,
    tag: `order-${orderId}`,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
  };
}

/**
 * The once-only key for one change. `ref` tells apart events that can
 * legitimately repeat on one order (a second rejected proof, a new rider after
 * a release); for the rest the event itself happens at most once per order.
 */
export function orderPushDedupeKey(orderId: string, event: OrderPushEvent, ref?: string | null): string {
  return `${orderId}:${event}:${ref ?? ""}`;
}
