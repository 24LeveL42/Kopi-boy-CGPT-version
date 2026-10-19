import { createClient } from "@supabase/supabase-js";
import { handlePaymentProofPurge } from "@/lib/payment-proof-purge-server";

/**
 * Daily deletion of payment screenshots past the retention period, called by
 * pg_cron (docs/supabase-order-timers.sql). Shared-secret only; see
 * src/lib/payment-proof-purge-server.ts for what it does.
 */
export async function POST(request: Request) {
  return handlePaymentProofPurge(request, {
    env: {
      PUSH_WEBHOOK_SECRET: process.env.PUSH_WEBHOOK_SECRET,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  });
}
