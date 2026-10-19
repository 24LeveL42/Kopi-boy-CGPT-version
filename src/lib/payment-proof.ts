/**
 * Proof of PayNow payment. After the cook accepts, the customer pays them by
 * PayNow outside the app and uploads a screenshot; the cook checks it and
 * marks the order paid (or rejects the proof, stamping
 * payment_proof_rejected_at). The bucket, columns and the
 * submit_payment_proof(p_order_id, p_path) RPC live in Supabase.
 *
 * Time to pay: the database stamps orders.payment_due_at when the cook
 * accepts (accepted time + public.payment_window_minutes()) and a pg_cron job
 * cancels the order if no proof arrives by then (docs/supabase-order-timers.sql).
 * The app never decides that time itself; it only counts down to it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_CHAT_PHOTO_MAX_BYTES, ORDER_CHAT_PHOTO_TYPES } from "@/lib/messages";

/** Private bucket; same 5 MB limit and image types as order-chat-photos. */
export const PAYMENT_PROOF_BUCKET = "payment-proofs";
export const PAYMENT_PROOF_MAX_BYTES = ORDER_CHAT_PHOTO_MAX_BYTES;
export const PAYMENT_PROOF_TYPES = ORDER_CHAT_PHOTO_TYPES;
export const PAYMENT_PROOF_URL_TTL_SECONDS = 60 * 60;

/** orders.cancel_reason set by the auto-cancel job. */
export const NOT_PAID_IN_TIME = "not_paid_in_time";

/** What submit_payment_proof raises when the auto-cancel job got there first (docs/supabase-order-timers.sql §5). */
export const NOT_PAID_IN_TIME_UPLOAD_ERROR = "This order was cancelled because payment wasn't received in time";

/**
 * Wording only: screenshots older than this are deleted by the daily purge
 * (public.payment_proof_retention_days() in docs/supabase-order-timers.sql
 * decides which ones).
 */
export const PAYMENT_PROOF_RETENTION_DAYS = 60;

const SHRINK_MAX_SIDE = 1600;
const SHRINK_QUALITY = 0.8;
// Under this, and already within SHRINK_MAX_SIDE, a screenshot goes up as-is.
const SHRINK_ABOVE_BYTES = 1024 * 1024;

export interface PaymentProofColumns {
  order_status: string;
  payment_status: string;
  /** Absent until the payment-proof migration has run. */
  payment_proof_path?: string | null;
  payment_proof_uploaded_at?: string | null;
  payment_proof_rejected_at?: string | null;
  /** Set when the daily purge deleted the screenshot; payment_proof_path is cleared then. */
  payment_proof_removed_at?: string | null;
}

/**
 * pay: accepted + unpaid, nothing uploaded yet (or nothing usable).
 * sent: proof uploaded, waiting for the cook.
 * rejected: the cook rejected the latest proof.
 * paid: payment confirmed.
 * null: nothing to show (not accepted yet, or cancelled/rejected).
 */
export type PaymentProofState = "pay" | "sent" | "rejected" | "paid";

export function getPaymentProofState(order: PaymentProofColumns): PaymentProofState | null {
  if (order.order_status === "cancelled" || order.order_status === "rejected") return null;
  if (order.payment_status === "paid") return "paid";
  if (order.order_status !== "accepted" || order.payment_status !== "unpaid") return null;
  const uploadedAt = order.payment_proof_uploaded_at ? Date.parse(order.payment_proof_uploaded_at) : NaN;
  // A purged screenshot was still uploaded: that order stays "sent", not "pay".
  const hasProof = Boolean(order.payment_proof_path) || Boolean(order.payment_proof_removed_at);
  if (!hasProof || !Number.isFinite(uploadedAt)) return "pay";
  const rejectedAt = order.payment_proof_rejected_at ? Date.parse(order.payment_proof_rejected_at) : NaN;
  return Number.isFinite(rejectedAt) && rejectedAt > uploadedAt ? "rejected" : "sent";
}

/** What the customer puts in the PayNow comment so the cook can match the payment. */
export function shortOrderId(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Milliseconds left until orders.payment_due_at, or null when it isn't set. Negative once passed. */
export function paymentTimeLeftMs(paymentDueAt: string | null | undefined, now: number): number | null {
  const due = paymentDueAt ? Date.parse(paymentDueAt) : NaN;
  return Number.isFinite(due) ? due - now : null;
}

/** "m:ss", floored at 0:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The value of public.payment_window_minutes(), or null if it can't be read (e.g. before the migration). */
export async function getPaymentWindowMinutes(supabase: Pick<SupabaseClient, "rpc">): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc("payment_window_minutes");
    return !error && typeof data === "number" && Number.isInteger(data) && data > 0 ? data : null;
  } catch {
    return null;
  }
}

/** "within 5 minutes" from the database setting; "within a few minutes" when it couldn't be read. */
export function paymentWindowText(minutes: number | null): string {
  if (minutes === null) return "within a few minutes";
  return `within ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * Re-encodes a big image as a JPEG at most 1600px on its longest side.
 * Returns the original when it's already small, and throws when the browser
 * can't decode it (e.g. HEIC on most browsers) — the caller falls back.
 */
async function shrinkImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, SHRINK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SHRINK_ABOVE_BYTES) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    // JPEG has no alpha: give transparent PNGs a white background, not black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", SHRINK_QUALITY));
    if (!blob) throw new Error("toBlob failed");
    const name = file.name.replace(/\.[^.]*$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/** The file to upload, or why it can't be. */
export async function preparePaymentProof(file: File): Promise<{ file: File } | { error: string }> {
  if (!PAYMENT_PROOF_TYPES.includes(file.type)) return { error: "Please choose a JPEG, PNG, WebP or HEIC screenshot." };
  let ready: File | null = null;
  try {
    ready = await shrinkImage(file);
  } catch {
    ready = null;
  }
  if (ready && ready.size <= PAYMENT_PROOF_MAX_BYTES) return { file: ready };
  if (file.size <= PAYMENT_PROOF_MAX_BYTES) return { file };
  return { error: "That screenshot is over 5 MB — please choose a smaller one." };
}
