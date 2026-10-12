/**
 * Proof of PayNow payment. After the cook accepts, the customer pays them by
 * PayNow outside the app and uploads a screenshot; the cook checks it and
 * marks the order paid (or rejects the proof, stamping
 * payment_proof_rejected_at). The bucket, columns and the
 * submit_payment_proof(p_order_id, p_path) RPC live in Supabase.
 */
import { ORDER_CHAT_PHOTO_MAX_BYTES, ORDER_CHAT_PHOTO_TYPES } from "@/lib/messages";

/** Private bucket; same 5 MB limit and image types as order-chat-photos. */
export const PAYMENT_PROOF_BUCKET = "payment-proofs";
export const PAYMENT_PROOF_MAX_BYTES = ORDER_CHAT_PHOTO_MAX_BYTES;
export const PAYMENT_PROOF_TYPES = ORDER_CHAT_PHOTO_TYPES;
export const PAYMENT_PROOF_URL_TTL_SECONDS = 60 * 60;

/** Shown as a countdown from orders.decided_at. Display only — nothing auto-cancels yet. */
export const PAYMENT_WINDOW_MS = 15 * 60_000;

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
  if (!order.payment_proof_path || !Number.isFinite(uploadedAt)) return "pay";
  const rejectedAt = order.payment_proof_rejected_at ? Date.parse(order.payment_proof_rejected_at) : NaN;
  return Number.isFinite(rejectedAt) && rejectedAt > uploadedAt ? "rejected" : "sent";
}

/** What the customer puts in the PayNow comment so the cook can match the payment. */
export function shortOrderId(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Milliseconds left to pay, or null when the order has no decided_at. Negative once passed. */
export function paymentTimeLeftMs(decidedAt: string | null, now: number): number | null {
  const decided = decidedAt ? Date.parse(decidedAt) : NaN;
  return Number.isFinite(decided) ? decided + PAYMENT_WINDOW_MS - now : null;
}

/** "mm:ss", floored at 00:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
