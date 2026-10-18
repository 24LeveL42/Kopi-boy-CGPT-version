"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";
import {
  SUPPORT_MESSAGE_COLUMNS,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_MESSAGE_STATUS_LABEL,
  supportMessageLength,
  supportMessageSendErrorText,
  validateSupportMessage,
  type SupportMessage,
} from "@/lib/support-messages";

const HISTORY_LIMIT = 20;

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * "Message Kopi Boy" form + the customer's own past messages and HQ's
 * replies. The sender_id filter is for clarity; RLS on admin_messages is what
 * keeps anyone else's messages out (src/lib/support-messages.ts).
 */
export function SupportMessageForm({ userId }: { userId: string }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, startSend] = useTransition();

  const load = useCallback(async () => {
    const { data, error: fetchError } = await createClient()
      .from("admin_messages")
      .select(SUPPORT_MESSAGE_COLUMNS)
      .eq("sender_id", userId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .returns<SupportMessage[]>();
    if (fetchError) {
      setStatus("error");
      return;
    }
    setMessages(data ?? []);
    setStatus("ready");
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const length = supportMessageLength(draft.trim());
  const tooLong = length > SUPPORT_MESSAGE_MAX_LENGTH;

  function send(e: React.FormEvent) {
    e.preventDefault();
    const checked = validateSupportMessage(draft);
    setSent(false);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    startSend(async () => {
      const { error: insertError } = await createClient()
        .from("admin_messages")
        .insert({ sender_id: userId, message: checked.message });
      if (insertError) {
        setError(supportMessageSendErrorText(insertError));
        return;
      }
      setDraft("");
      setSent(true);
      await load();
    });
  }

  return (
    <section className="kb-cart-card mt-4" data-testid="support-message-form">
      <form onSubmit={send}>
        <label htmlFor="support-message" className="text-xs font-black uppercase tracking-[.14em] text-purple-600">
          Message Kopi Boy
        </label>
        <p className="mt-1 text-xs text-slate-500">For a problem with one order, use &quot;Report an issue&quot; on that order&apos;s page instead.</p>
        <textarea
          id="support-message"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            setSent(false);
          }}
          maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
          rows={4}
          placeholder="How can we help?"
          aria-describedby="support-message-count"
          className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        />
        <p id="support-message-count" className={`mt-1 text-right text-xs ${tooLong ? "text-red-600" : "text-slate-400"}`}>
          {length}/{SUPPORT_MESSAGE_MAX_LENGTH}
        </p>
        {error && (
          <p role="alert" className="mt-2 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-600">
            {error}
          </p>
        )}
        {sent && (
          <p role="status" className="mt-2 rounded-2xl bg-[#e5f8ef] p-3 text-sm font-semibold text-[#08795d]">
            Message sent. Our reply will appear below.
          </p>
        )}
        <button type="submit" disabled={busy || length === 0 || tooLong} className="kb-primary-button mt-3 w-full disabled:opacity-60">
          {busy && <Spinner />}
          {busy ? "Sending…" : "Send message"}
        </button>
      </form>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-xs font-black uppercase tracking-[.14em] text-purple-600">Your messages</p>
        {status === "loading" ? (
          <p className="mt-2 text-sm text-slate-500">Loading…</p>
        ) : status === "error" ? (
          <p className="mt-2 text-sm text-slate-500">Couldn&apos;t load your messages. Please check your connection.</p>
        ) : messages.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No messages yet.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {messages.map((m) => (
              <li key={m.id} data-testid="support-message" className="rounded-2xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">You · {formatTimestamp(m.created_at)}</span>
                  <span className="kb-mini-pill">{SUPPORT_MESSAGE_STATUS_LABEL[m.status] ?? m.status}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{m.message}</p>
                {m.admin_reply ? (
                  <div className="mt-2 rounded-xl bg-purple-50 px-3 py-2">
                    <p className="text-xs font-bold text-purple-700">
                      Kopi Boy{m.replied_at ? ` · ${formatTimestamp(m.replied_at)}` : ""}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-800">{m.admin_reply}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs italic text-slate-400">No reply yet.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
