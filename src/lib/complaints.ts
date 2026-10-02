/**
 * Support chat (customer <-> HQ) — shape + pure helpers. Rows come from the
 * `complaint_messages` table (docs/supabase-schema.sql §25): one thread per
 * order, readable/writable by that order's customer and by any admin, never
 * closed. HQ can mark it resolved (§29), which makes it undeletable. RLS (`complaint_thread_participant`) is the only thing enforcing
 * who can see/send; nothing here duplicates it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ComplaintMessageRow {
  id: string;
  order_id: string;
  sender_id: string;
  body: string;
  /** Key in the private `complaint-photos` bucket, not a URL — see signed URLs in SupportChat. */
  photo_path: string | null;
  created_at: string;
}

export const COMPLAINT_PHOTO_BUCKET = "complaint-photos";

/** Matches the bucket's file_size_limit (§26). Checked client-side only to give a clear error before uploading. */
export const COMPLAINT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Matches the bucket's allowed_mime_types (§26). */
export const COMPLAINT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** How long a rendered evidence photo link stays valid. */
export const COMPLAINT_PHOTO_URL_TTL_SECONDS = 60 * 60;

/** Returns why a picked file can't be attached, or null if it's fine. */
export function validateComplaintPhoto(file: { type: string; size: number }): string | null {
  if (!COMPLAINT_PHOTO_TYPES.includes(file.type)) return "Please choose a JPEG, PNG, WebP or HEIC photo.";
  if (file.size > COMPLAINT_PHOTO_MAX_BYTES) return "That photo is over 5 MB — please choose a smaller one.";
  return null;
}

/**
 * Object key for an uploaded photo: `<order_id>/<uploader_id>/<random>.<ext>`.
 * The storage policies require exactly this layout (first folder = an order
 * the uploader can post to, second = the uploader), and the table's check
 * requires photo_path to sit under the message's own order.
 */
export function complaintPhotoPath(orderId: string, userId: string, fileName: string, id: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "jpg";
  return `${orderId}/${userId}/${id}.${ext}`;
}

/**
 * A message needs text or a photo (the table's body check allows an empty
 * body only alongside a photo). Returns the trimmed body, or null when there's
 * nothing sendable.
 */
export function normalizeComplaintBody(raw: string, hasPhoto: boolean, maxLength: number): string | null {
  const body = raw.trim();
  if (body.length > maxLength) return null;
  if (!body && !hasPhoto) return null;
  return body;
}

/** The slice of a supabase-js client clearComplaintThread() needs. */
export type ComplaintClearClient = Pick<SupabaseClient, "from" | "storage">;

/** `resolved: true` = HQ has marked the thread resolved (schema §29), so it can no longer be cleared. */
export type ClearComplaintResult = { ok: true } | { ok: false; message: string; resolved?: true };

export const COMPLAINT_RESOLVED_MESSAGE = "Kopi Boy Support has marked this chat resolved — it's kept as a record and can't be cleared.";

/** Whether HQ has marked the order's thread resolved; null if that couldn't be checked. */
export async function isComplaintResolved(supabase: Pick<SupabaseClient, "from">, orderId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from("complaint_resolutions").select("order_id").eq("order_id", orderId).maybeSingle();
  if (error) return null;
  return data !== null;
}

const STORAGE_PAGE_SIZE = 1000;

/** Every object key under `<orderId>/` in the bucket (one level of uploader folders, per complaintPhotoPath). */
async function listOrderPhotos(supabase: ComplaintClearClient, orderId: string): Promise<string[] | null> {
  const bucket = supabase.storage.from(COMPLAINT_PHOTO_BUCKET);
  async function listAll(prefix: string) {
    const entries: { name: string; id: string | null }[] = [];
    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const { data, error } = await bucket.list(prefix, { limit: STORAGE_PAGE_SIZE, offset });
      if (error || !data) return null;
      entries.push(...data);
      if (data.length < STORAGE_PAGE_SIZE) return entries;
    }
  }
  const folders = await listAll(orderId);
  if (!folders) return null;
  const paths: string[] = [];
  for (const entry of folders) {
    // Storage lists a sub-folder as an entry with a null id.
    if (entry.id !== null) {
      paths.push(`${orderId}/${entry.name}`);
      continue;
    }
    const files = await listAll(`${orderId}/${entry.name}`);
    if (!files) return null;
    for (const f of files) if (f.id !== null) paths.push(`${orderId}/${entry.name}/${f.name}`);
  }
  return paths;
}

/**
 * "Clear chat": permanently deletes an order's whole complaint thread — every
 * message row (HQ's too) and every photo under the order's folder in the
 * bucket. Allowed only for the order's customer, and only while HQ hasn't
 * marked the thread resolved (schema §29: complaint_thread_clearable). The
 * resolution check up front keeps a resolved thread's photos from being
 * touched at all; RLS enforces the same rule on both deletes. HQ resolving
 * mid-clear can still leave a resolved thread missing some photos — Storage
 * and the table can't be deleted from atomically.
 *
 * Photos go first: if that fails the messages are still there to retry from,
 * and a retry re-lists the folder, so it picks up whatever is left. Both
 * steps are re-checked afterwards because an RLS-denied delete doesn't error —
 * Storage just removes nothing and PostgREST deletes 0 rows.
 */
export async function clearComplaintThread(supabase: ComplaintClearClient, orderId: string): Promise<ClearComplaintResult> {
  const resolvedFailure: ClearComplaintResult = { ok: false, message: COMPLAINT_RESOLVED_MESSAGE, resolved: true };
  const resolved = await isComplaintResolved(supabase, orderId);
  if (resolved === null) return { ok: false, message: "Couldn't check this chat's status — nothing was removed. Please try again." };
  if (resolved) return resolvedFailure;

  const photoFailure: ClearComplaintResult = { ok: false, message: "Couldn't delete the photos — nothing else was removed. Please try again." };

  const photos = await listOrderPhotos(supabase, orderId);
  if (!photos) return photoFailure;
  if (photos.length > 0) {
    for (let i = 0; i < photos.length; i += STORAGE_PAGE_SIZE) {
      const { error } = await supabase.storage.from(COMPLAINT_PHOTO_BUCKET).remove(photos.slice(i, i + STORAGE_PAGE_SIZE));
      if (error) return photoFailure;
    }
    const left = await listOrderPhotos(supabase, orderId);
    if (!left || left.length > 0) return (await isComplaintResolved(supabase, orderId)) ? resolvedFailure : photoFailure;
  }

  const rowFailure: ClearComplaintResult = { ok: false, message: "Couldn't delete the messages — please try again." };
  const { error: deleteError } = await supabase.from("complaint_messages").delete().eq("order_id", orderId);
  if (deleteError) return rowFailure;
  const { count, error: countError } = await supabase
    .from("complaint_messages")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);
  if (countError || count !== 0) return (await isComplaintResolved(supabase, orderId)) ? resolvedFailure : rowFailure;

  return { ok: true };
}
