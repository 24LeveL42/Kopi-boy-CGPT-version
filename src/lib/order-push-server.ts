import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrderPushPayload, isOrderPushEvent, isUuid, orderPushDedupeKey } from "@/lib/order-push";

/**
 * Handler behind POST /api/push/order-update. Called by the database
 * (private.send_customer_order_push, docs/supabase-customer-push.sql) through
 * pg_net, authenticated by the same shared secret the Partner app's push
 * webhook uses (`x-webhook-secret`). Runs with the service-role key, so
 * nothing happens before that secret checks out.
 *
 * Dependencies are injected so tests can drive it without a database or a
 * push service; the route file passes the real ones.
 */

export interface OrderPushEnv {
  PUSH_WEBHOOK_SECRET?: string;
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface OrderPushDeps {
  env: OrderPushEnv;
  createAdmin: (url: string, serviceRoleKey: string) => SupabaseClient;
  /** web-push's sendNotification, already given the VAPID details. Rejects with { statusCode } on failure. */
  send: (target: PushTarget, payload: string) => Promise<unknown>;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  // Hash both so the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function handleOrderPushWebhook(request: Request, deps: OrderPushDeps): Promise<Response> {
  const { env } = deps;
  if (
    !env.PUSH_WEBHOOK_SECRET ||
    !env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    !env.VAPID_PRIVATE_KEY ||
    !env.VAPID_SUBJECT ||
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return json({ error: "Push sender is not configured" }, 503);
  }

  if (!sameSecret(request.headers.get("x-webhook-secret"), env.PUSH_WEBHOOK_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { order_id?: unknown; event?: unknown; ref?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const orderId = body?.order_id;
  const event = body?.event;
  const ref = typeof body?.ref === "string" ? body.ref : null;
  if (!isUuid(orderId) || !isOrderPushEvent(event)) {
    return json({ error: "Unknown order or event" }, 400);
  }
  const payload = buildOrderPushPayload(event, orderId)!;

  const admin = deps.createAdmin(env.NEXT_PUBLIC_SUPABASE_URL.trim(), env.SUPABASE_SERVICE_ROLE_KEY.trim());

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("customer_id")
    .eq("id", orderId)
    .maybeSingle<{ customer_id: string }>();
  if (orderError) {
    console.error("order push: loading order failed:", orderError);
    return json({ error: "Could not load order", code: orderError.code, message: orderError.message }, 500);
  }
  if (!order) return json({ skipped: "order not found" });

  // Once-only: the first delivery of a change claims its key; a repeat (a
  // re-sent webhook, a retried request) hits the unique key and stops here.
  const { error: claimError } = await admin
    .from("customer_push_log")
    .insert({ dedupe_key: orderPushDedupeKey(orderId, event, ref), order_id: orderId, event });
  if (claimError) {
    if (claimError.code === "23505") return json({ duplicate: true });
    console.error("order push: recording the push failed:", claimError);
    return json({ error: "Could not record push", code: claimError.code, message: claimError.message }, 500);
  }

  const { data: subs, error: subsError } = await admin
    .from("customer_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", order.customer_id)
    .returns<{ id: string; endpoint: string; p256dh: string; auth: string }[]>();
  if (subsError) {
    console.error("order push: loading subscriptions failed:", subsError);
    return json({ error: "Could not load subscriptions", code: subsError.code, message: subsError.message }, 500);
  }

  const message = JSON.stringify(payload);
  const gone: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await deps.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message);
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser unsubscribed or the subscription expired.
        if (status === 404 || status === 410) gone.push(s.id);
        else {
          failed += 1;
          console.error("order push: send failed:", status, err);
        }
      }
    })
  );

  if (gone.length > 0) {
    const { error } = await admin.from("customer_push_subscriptions").delete().in("id", gone);
    if (error) console.error("order push: removing expired subscriptions failed:", error);
  }

  // Lands in net._http_response, so delivery can be checked from the SQL editor.
  return json({ subscriptions: subs?.length ?? 0, sent, failed, removed: gone.length });
}
