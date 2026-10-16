import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { handleOrderPushWebhook } from "@/lib/order-push-server";

/**
 * Order-update Web Push, called by the database when an order changes
 * (docs/supabase-customer-push.sql). Shared-secret only; see
 * src/lib/order-push-server.ts for what it does.
 */
export async function POST(request: Request) {
  const env = {
    PUSH_WEBHOOK_SECRET: process.env.PUSH_WEBHOOK_SECRET,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  return handleOrderPushWebhook(request, {
    env,
    createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    send: (target, payload) =>
      webpush.sendNotification(target, payload, {
        TTL: 60 * 60,
        urgency: "high",
        vapidDetails: {
          subject: env.VAPID_SUBJECT!,
          publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
          privateKey: env.VAPID_PRIVATE_KEY!,
        },
      }),
  });
}
