"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { CameraIcon } from "@/components/CameraIcon";
import { ChatBubble } from "@/components/ChatBubble";
import { Spinner } from "@/components/Spinner";
import { mergeMessages, MESSAGE_BODY_MAX_LENGTH, MESSAGE_FETCH_LIMIT } from "@/lib/messages";
import {
  COMPLAINT_PHOTO_BUCKET,
  COMPLAINT_PHOTO_TYPES,
  COMPLAINT_PHOTO_URL_TTL_SECONDS,
  clearComplaintThread,
  isComplaintResolved,
  complaintPhotoPath,
  normalizeComplaintBody,
  validateComplaintPhoto,
  type ComplaintMessageRow,
} from "@/lib/complaints";

type ChatStatus = "loading" | "ready" | "error";

/**
 * Support chat with HQ about one order ("Report an issue"). Same Realtime
 * pattern as OrderChat: subscribe first, fetch on SUBSCRIBED, de-dupe by id,
 * fetch-only fallback on CHANNEL_ERROR/TIMED_OUT, and a sent message reaches
 * the sender's own screen via the Realtime echo rather than an optimistic
 * insert.
 *
 * Unlike OrderChat there is no visibility window: the thread is open for the
 * order's whole life and afterwards, as the record of the complaint (RLS:
 * complaint_thread_participant — the order's customer or any admin).
 *
 * Evidence photos live in the private complaint-photos bucket; a message
 * stores the object key and this component swaps it for a short-lived signed
 * URL to render.
 *
 * "Clear chat" is the one exception to "never closes": while HQ hasn't
 * marked the thread resolved, the customer can permanently delete it and its
 * photos after confirming (schema §29). Once resolved — on load, or live via
 * Realtime — the button goes and the thread is a permanent record.
 */
export function SupportChat({ orderId, currentUserId }: { orderId: string; currentUserId: string }) {
  const [status, setStatus] = useState<ChatStatus>("loading");
  const [messages, setMessages] = useState<ComplaintMessageRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, startSending] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const [clearing, startClearing] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);
  // null = not known (still loading, or the check failed) — Clear chat stays hidden.
  const [resolved, setResolved] = useState<boolean | null>(null);
  const messagesRef = useRef<ComplaintMessageRow[]>([]);
  const requestedPathsRef = useRef<Set<string>>(new Set());
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyMessages = useCallback((update: (prev: ComplaintMessageRow[]) => ComplaintMessageRow[]) => {
    const next = update(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let disposed = false;

    async function load() {
      void isComplaintResolved(supabase, orderId).then((r) => {
        // Never flip back to unresolved: resolution is permanent.
        if (!disposed) setResolved((prev) => (prev === true ? true : r));
      });
      const { data, error } = await supabase
        .from("complaint_messages")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_FETCH_LIMIT);
      if (disposed) return;
      if (error) {
        setStatus("error");
        return;
      }
      applyMessages((prev) => mergeMessages(prev, (data ?? []) as ComplaintMessageRow[]));
      setStatus("ready");
    }

    let loadedWithoutRealtime = false;
    const channel = supabase
      .channel(`complaint_messages:${orderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "complaint_messages", filter: `order_id=eq.${orderId}` },
        (payload) => {
          applyMessages((prev) => mergeMessages(prev, [payload.new as ComplaintMessageRow]));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "complaint_resolutions", filter: `order_id=eq.${orderId}` },
        () => setResolved(true)
      )
      .subscribe((subscribeStatus) => {
        if (disposed) return;
        if (subscribeStatus === "SUBSCRIBED") {
          void load();
        } else if ((subscribeStatus === "CHANNEL_ERROR" || subscribeStatus === "TIMED_OUT") && !loadedWithoutRealtime) {
          loadedWithoutRealtime = true;
          void load();
        }
      });

    return () => {
      disposed = true;
      supabase.removeChannel(channel);
    };
  }, [orderId, applyMessages]);

  // Sign any photo keys we haven't signed yet, in one batch per change.
  useEffect(() => {
    const missing = messages
      .map((m) => m.photo_path)
      .filter((p): p is string => Boolean(p) && !requestedPathsRef.current.has(p!));
    if (missing.length === 0) return;
    for (const p of missing) requestedPathsRef.current.add(p);
    let cancelled = false;
    createClient()
      .storage.from(COMPLAINT_PHOTO_BUCKET)
      .createSignedUrls(missing, COMPLAINT_PHOTO_URL_TTL_SECONDS)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const signed: Record<string, string> = {};
        for (const item of data) if (item.path && item.signedUrl) signed[item.path] = item.signedUrl;
        setPhotoUrls((prev) => ({ ...prev, ...signed }));
      });
    return () => {
      cancelled = true;
    };
  }, [messages]);

  useEffect(() => {
    // jsdom (tests) has no scrollIntoView; real browsers always do.
    listEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  function handlePhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!file) return;
    const problem = validateComplaintPhoto(file);
    if (problem) {
      setSendError(problem);
      return;
    }
    setSendError(null);
    setPhoto(file);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = normalizeComplaintBody(draft, photo !== null, MESSAGE_BODY_MAX_LENGTH);
    if (body === null || sending) return;
    setSendError(null);
    startSending(async () => {
      const supabase = createClient();

      let photoPath: string | null = null;
      if (photo) {
        photoPath = complaintPhotoPath(orderId, currentUserId, photo.name, crypto.randomUUID());
        const { error: uploadError } = await supabase.storage
          .from(COMPLAINT_PHOTO_BUCKET)
          .upload(photoPath, photo, { contentType: photo.type, upsert: false });
        if (uploadError) {
          setSendError("Photo couldn't be uploaded — please try again.");
          return;
        }
      }

      const { error } = await supabase
        .from("complaint_messages")
        .insert({ order_id: orderId, sender_id: currentUserId, body, photo_path: photoPath });
      if (error) {
        setSendError("Message couldn't be sent — please try again.");
        return;
      }
      setDraft("");
      setPhoto(null);
    });
  }

  function handleClear() {
    if (clearing) return;
    // Confirmed like the cart's "Clear all" — but this one can't be undone and HQ loses the thread too.
    if (
      !window.confirm(
        "Delete this whole support chat, including any photos? This can't be undone, and Kopi Boy Support will lose the conversation too."
      )
    )
      return;
    setClearError(null);
    startClearing(async () => {
      const result = await clearComplaintThread(createClient(), orderId);
      if (!result.ok) {
        if (result.resolved) setResolved(true);
        setClearError(result.message);
        return;
      }
      applyMessages(() => []);
      setPhotoUrls({});
      requestedPathsRef.current = new Set();
    });
  }

  const canSend = !sending && normalizeComplaintBody(draft, photo !== null, MESSAGE_BODY_MAX_LENGTH) !== null;

  return (
    <div data-testid="support-chat" className="mt-3 rounded-xl text-left" style={{ background: "var(--kb-cream)" }}>
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <p className="text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
          Kopi Boy support — tell us what went wrong. You can attach a photo.
        </p>
        {status === "ready" && resolved === false && messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing}
            className="flex shrink-0 items-center gap-1 text-xs font-semibold disabled:opacity-50"
            style={{ color: "var(--kb-danger)" }}
          >
            {clearing && <Spinner size={12} />}
            {clearing ? "Clearing…" : "Clear chat"}
          </button>
        )}
      </div>
      {resolved && !clearError && (
        <p data-testid="support-resolved" className="px-3 pt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
          Resolved by Kopi Boy Support — this chat is kept as a record.
        </p>
      )}
      {clearError && (
        <p className="px-3 pt-1 text-xs" style={{ color: "var(--kb-danger)" }}>
          {clearError}
        </p>
      )}

      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto px-3 py-2">
        {status === "loading" && (
          <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            Loading messages…
          </p>
        )}
        {status === "error" && (
          <p className="text-xs" style={{ color: "var(--kb-danger)" }}>
            Couldn&apos;t load messages.
          </p>
        )}
        {status === "ready" && messages.length === 0 && (
          <p className="text-xs" style={{ color: "var(--kb-ink-soft)" }}>
            No messages yet. Our team will reply here.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === currentUserId;
          const url = m.photo_path ? photoUrls[m.photo_path] : undefined;
          return (
            <ChatBubble key={m.id} mine={mine} senderLabel="Kopi Boy Support" testId="support-message">
              {m.photo_path &&
                (url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {/* Short-lived signed URL from a private bucket — next/image can't (and shouldn't) cache it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Attached photo" data-testid="support-photo" className="max-h-48 w-full object-cover" />
                  </a>
                ) : (
                  <span className="block px-3 py-1.5 text-xs opacity-80">Loading photo…</span>
                ))}
              {m.body && <p className="px-3 py-1.5">{m.body}</p>}
            </ChatBubble>
          );
        })}
        <div ref={listEndRef} />
      </div>

      {photo && (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs" style={{ borderColor: "var(--kb-navy-line)", color: "var(--kb-ink)" }}>
          <span className="truncate">📎 {photo.name}</span>
          <button type="button" onClick={() => setPhoto(null)} disabled={sending} className="shrink-0 font-semibold disabled:opacity-50" style={{ color: "var(--kb-danger)" }}>
            Remove
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t p-2" style={{ borderColor: "var(--kb-navy-line)" }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={COMPLAINT_PHOTO_TYPES.join(",")}
          onChange={handlePhotoPicked}
          className="hidden"
          aria-label="Attach photo"
          data-testid="support-photo-input"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          aria-label="Attach a photo"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white disabled:opacity-50"
          style={{ color: "var(--kb-ink-soft)" }}
        >
          <CameraIcon />
        </button>
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setSendError(null);
            setDraft(e.target.value);
          }}
          maxLength={MESSAGE_BODY_MAX_LENGTH}
          placeholder="Describe the issue…"
          aria-label="Message"
          className="min-w-0 flex-1 rounded-full bg-white px-3 py-1.5 text-sm outline-none"
          style={{ color: "var(--kb-ink)" }}
        />
        <button
          type="submit"
          disabled={!canSend}
          className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--kb-green-deep)" }}
        >
          {sending && <Spinner />}
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      {sendError && (
        <p className="px-3 pb-2 text-xs" style={{ color: "var(--kb-danger)" }}>
          {sendError}
        </p>
      )}
    </div>
  );
}

/** "Report an issue" entry point: starts collapsed unless a thread already exists for this order. */
export function SupportChatToggle({
  orderId,
  currentUserId,
  hasThread,
}: {
  orderId: string;
  currentUserId: string;
  hasThread: boolean;
}) {
  const [open, setOpen] = useState(hasThread);

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full rounded-xl border py-2.5 text-sm font-semibold"
        style={{ borderColor: "var(--kb-cream)", color: "var(--kb-ink)" }}
      >
        {open ? "Hide support chat" : hasThread ? "Support chat" : "Report an issue"}
      </button>
      {open && <SupportChat orderId={orderId} currentUserId={currentUserId} />}
    </div>
  );
}
