/**
 * "Message Kopi Boy" on the Help page. Uses the same public.admin_messages
 * table the Partner app uses for partners writing to HQ (Partner repo's
 * docs/supabase-admin-messages.sql). Its RLS already fits customers: anyone
 * signed in can insert a row with sender_id = themselves and read only their
 * own rows; only admins read everyone's and reply. A trigger sets
 * sender_role from profiles ('customer'), status, created_at and allows 5
 * messages per 24 hours. Must stay in sync with that table's 500-character
 * check.
 */

export const SUPPORT_MESSAGE_MAX_LENGTH = 500;

export type SupportMessageStatus = "open" | "replied" | "closed";

export interface SupportMessage {
  id: string;
  message: string;
  admin_reply: string | null;
  replied_at: string | null;
  status: SupportMessageStatus;
  created_at: string;
}

export const SUPPORT_MESSAGE_COLUMNS = "id, message, admin_reply, replied_at, status, created_at";

export const SUPPORT_MESSAGE_STATUS_LABEL: Record<SupportMessageStatus, string> = {
  open: "Waiting for reply",
  replied: "Replied",
  closed: "Closed",
};

/** Length as Postgres' char_length counts it (code points), so an emoji counts once. */
export function supportMessageLength(text: string): number {
  return Array.from(text).length;
}

export function validateSupportMessage(raw: string): { ok: true; message: string } | { ok: false; error: string } {
  const message = String(raw ?? "").trim();
  if (!message) return { ok: false, error: "Please write a message first." };
  const length = supportMessageLength(message);
  if (length > SUPPORT_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Please keep your message to ${SUPPORT_MESSAGE_MAX_LENGTH} characters (it's ${length} now).` };
  }
  return { ok: true, message };
}

/** The rate-limit trigger's message is written for people, so it's shown as is; anything else gets a generic line. */
export function supportMessageSendErrorText(error: { message?: string; hint?: string | null }): string {
  if (error.hint === "admin_messages_rate_limit" && error.message) return error.message;
  return "Your message couldn't be sent. Please check your connection and try again.";
}
