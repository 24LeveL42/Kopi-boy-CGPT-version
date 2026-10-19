import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sameSecret } from "@/lib/order-push-server";
import { PAYMENT_PROOF_BUCKET } from "@/lib/payment-proof";

/**
 * Handler behind POST /api/cron/purge-payment-proofs. Called once a day by
 * pg_cron through pg_net (private.request_payment_proof_purge,
 * docs/supabase-order-timers.sql) with the same shared secret as the push
 * webhook. Supabase blocks deleting storage.objects rows in SQL, so the files
 * go through the Storage API here, with the service-role key.
 *
 * The database decides what is old enough: public.expired_payment_proof_files
 * only ever returns screenshots older than public.payment_proof_retention_days()
 * by the database clock, and only those names are deleted. Then
 * public.clear_removed_payment_proofs() clears payment_proof_path (stamping
 * payment_proof_removed_at) on every order whose file is gone — the order row
 * itself is kept. Running it again finds nothing new, so repeats are harmless.
 */

export interface PurgeEnv {
  PUSH_WEBHOOK_SECRET?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface PurgeDeps {
  env: PurgeEnv;
  createAdmin: (url: string, serviceRoleKey: string) => SupabaseClient;
}

/** Files per Storage API call, and calls per run; anything left over goes tomorrow. */
export const PURGE_BATCH_SIZE = 100;
export const PURGE_MAX_BATCHES = 20;

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export async function handlePaymentProofPurge(request: Request, deps: PurgeDeps): Promise<Response> {
  const { env } = deps;
  if (!env.PUSH_WEBHOOK_SECRET || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Purge is not configured" }, 503);
  }
  if (!sameSecret(request.headers.get("x-webhook-secret"), env.PUSH_WEBHOOK_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = deps.createAdmin(env.NEXT_PUBLIC_SUPABASE_URL.trim(), env.SUPABASE_SERVICE_ROLE_KEY.trim());

  let deleted = 0;
  let failed: string | null = null;
  let more = false;
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
    const { data, error } = await admin.rpc("expired_payment_proof_files", { p_limit: PURGE_BATCH_SIZE });
    if (error) {
      failed = `listing expired files failed: ${error.message}`;
      break;
    }
    const names = ((data as unknown[] | null) ?? []).filter((n): n is string => typeof n === "string" && n.length > 0);
    if (names.length === 0) break;

    const { data: removed, error: removeError } = await admin.storage.from(PAYMENT_PROOF_BUCKET).remove(names);
    if (removeError) {
      failed = `deleting files failed: ${removeError.message}`;
      break;
    }
    deleted += removed?.length ?? 0;
    // Nothing went although the list wasn't empty: stop rather than ask for the same names forever.
    if (!removed?.length) {
      failed = "storage removed none of the listed files";
      break;
    }
    more = batch === PURGE_MAX_BATCHES - 1;
  }

  // Run even after a failure: it only touches orders whose file is really gone.
  const { data: cleared, error: clearError } = await admin.rpc("clear_removed_payment_proofs");
  if (clearError) failed ??= `clearing order references failed: ${clearError.message}`;

  const summary = { deleted, cleared: typeof cleared === "number" ? cleared : 0, more };
  if (failed) {
    console.error("payment proof purge:", failed, summary);
    return json({ error: failed, ...summary }, 500);
  }
  // Lands in the Vercel logs and in net._http_response.
  console.log(`payment proof purge: deleted ${summary.deleted} file(s), cleared ${summary.cleared} order(s)`);
  return json(summary);
}
