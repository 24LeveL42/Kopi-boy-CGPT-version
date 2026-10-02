/**
 * Order chat — shape + pure helpers. Rows come from the `messages` table
 * (Partner app's docs/supabase-messages.sql: sender is either the order's
 * customer or its assigned rider), written by whoever is chatting and read
 * live via Supabase Realtime. RLS (`order_chat_participant`) is the only
 * thing enforcing who can see/send a given order's rows — this app never
 * duplicates that check client-side, only mirrors its *visibility window*
 * (rider assigned, not yet delivered/cancelled/rejected) so the chat box
 * disappears from the UI at the same moment RLS would start rejecting it.
 */

export interface MessageRow {
  id: string;
  order_id: string;
  sender_id: string;
  /** May be empty only when photo_path is set (messages_body_check). */
  body: string;
  /** Key in the private order-chat-photos bucket (Partner app's docs/supabase-messages.sql §4-5), not a URL. */
  photo_path: string | null;
  /**
   * The rider's proof-of-delivery message (Partner app's
   * docs/supabase-messages.sql §6-7). The one message that stays readable
   * by the customer after the delivery is completed.
   */
  is_delivery_proof: boolean;
  created_at: string;
}

/** The Partner app's private bucket for chat photos — it owns the bucket and its policies. */
export const ORDER_CHAT_PHOTO_BUCKET = "order-chat-photos";

/** Matches the bucket's file_size_limit. Checked client-side only to give a clear error before uploading. */
export const ORDER_CHAT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Matches the bucket's allowed_mime_types. */
export const ORDER_CHAT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** How long a rendered photo link stays valid. */
export const ORDER_CHAT_PHOTO_URL_TTL_SECONDS = 60 * 60;

/** Matches the `messages.body` check constraint (docs/supabase-messages.sql). */
export const MESSAGE_BODY_MAX_LENGTH = 2000;

/** How many past messages a chat loads on open (newest are what matters if a thread ever got long). */
export const MESSAGE_FETCH_LIMIT = 200;

/**
 * Merges freshly-fetched rows into what's already in state. Realtime can
 * deliver a row before the initial fetch resolves (or the fetch can include
 * a row realtime already delivered), so union by id and sort oldest-first —
 * a chat reads top-to-bottom, unlike the notifications inbox.
 */
export function mergeMessages<T extends { id: string; created_at: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1
  );
}

/**
 * Trims and validates a draft message the same way the `body` check
 * constraint does: text is required unless a photo goes with it. Returns the
 * trimmed body (possibly empty alongside a photo), or null when there's
 * nothing sendable.
 */
export function normalizeMessageBody(raw: string, hasPhoto = false): string | null {
  const body = raw.trim();
  if (body.length > MESSAGE_BODY_MAX_LENGTH) return null;
  if (!body && !hasPhoto) return null;
  return body;
}

/** Returns why a picked file can't be attached, or null if it's fine. */
export function validateOrderChatPhoto(file: { type: string; size: number }): string | null {
  if (!ORDER_CHAT_PHOTO_TYPES.includes(file.type)) return "Please choose a JPEG, PNG, WebP or HEIC photo.";
  if (file.size > ORDER_CHAT_PHOTO_MAX_BYTES) return "That photo is over 5 MB — please choose a smaller one.";
  return null;
}

/**
 * Object key `<order_id>/<uploader_id>/<random>.<ext>` — the bucket's upload
 * policy requires exactly this layout (first folder = an order whose chat the
 * uploader is in, second = the uploader), and messages_photo_path_check
 * requires the key to sit under the message's own order.
 */
export function orderChatPhotoPath(orderId: string, userId: string, fileName: string, id: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "jpg";
  return `${orderId}/${userId}/${id}.${ext}`;
}
