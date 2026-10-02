"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { CameraIcon } from "@/components/CameraIcon";
import { ChatBubble } from "@/components/ChatBubble";
import { Spinner } from "@/components/Spinner";
import {
  mergeMessages,
  normalizeMessageBody,
  MESSAGE_BODY_MAX_LENGTH,
  MESSAGE_FETCH_LIMIT,
  ORDER_CHAT_PHOTO_BUCKET,
  ORDER_CHAT_PHOTO_TYPES,
  ORDER_CHAT_PHOTO_URL_TTL_SECONDS,
  orderChatPhotoPath,
  validateOrderChatPhoto,
  type MessageRow,
} from "@/lib/messages";

type ChatStatus = "loading" | "ready" | "error";

/**
 * Chat with the assigned rider for one order, while the delivery is active.
 * Same Realtime pattern as NotificationsProvider (src/lib/notifications-context.tsx):
 * subscribe first, then fetch on SUBSCRIBED, so a message sent between "fetch"
 * and "subscribe" can't be missed — anything delivered both ways is
 * de-duplicated by id. Falls back to a fetch-only load if the channel can't
 * connect (same CHANNEL_ERROR/TIMED_OUT fallback OrderRealtimeRefresher uses).
 *
 * The parent page only renders this while `delivery_requests` is `accepted`
 * and the order isn't cancelled/rejected — the same window the `messages`
 * table's RLS (`order_chat_participant`) enforces server-side. That RLS is
 * the real access control; this component just mirrors its visibility
 * window so the chat box vanishes from the UI at the same moment the
 * database would start rejecting it (e.g. once delivered), instead of
 * lingering with silent send failures.
 *
 * Either side can attach a photo. Photos live in the Partner-owned private
 * order-chat-photos bucket; a message stores the object key and this
 * component swaps it for a short-lived signed URL to render.
 */
export function OrderChat({
  orderId,
  currentUserId,
  riderName,
}: {
  orderId: string;
  currentUserId: string;
  riderName: string | null;
}) {
  const [status, setStatus] = useState<ChatStatus>("loading");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, startSending] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const messagesRef = useRef<MessageRow[]>([]);
  const requestedPathsRef = useRef<Set<string>>(new Set());
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const riderLabel = riderName?.trim() || "Your rider";

  const applyMessages = useCallback((update: (prev: MessageRow[]) => MessageRow[]) => {
    const next = update(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let disposed = false;

    async function load() {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_FETCH_LIMIT);
      if (disposed) return;
      if (error) {
        setStatus("error");
        return;
      }
      applyMessages((prev) => mergeMessages(prev, (data ?? []) as MessageRow[]));
      setStatus("ready");
    }

    let loadedWithoutRealtime = false;
    const channel = supabase
      .channel(`messages:${orderId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `order_id=eq.${orderId}` },
        (payload) => {
          applyMessages((prev) => mergeMessages(prev, [payload.new as MessageRow]));
        }
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
      .storage.from(ORDER_CHAT_PHOTO_BUCKET)
      .createSignedUrls(missing, ORDER_CHAT_PHOTO_URL_TTL_SECONDS)
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
    const problem = validateOrderChatPhoto(file);
    if (problem) {
      setSendError(problem);
      return;
    }
    setSendError(null);
    setPhoto(file);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = normalizeMessageBody(draft, photo !== null);
    if (body === null || sending) return;
    setSendError(null);
    startSending(async () => {
      const supabase = createClient();

      let photoPath: string | null = null;
      if (photo) {
        photoPath = orderChatPhotoPath(orderId, currentUserId, photo.name, crypto.randomUUID());
        const { error: uploadError } = await supabase.storage
          .from(ORDER_CHAT_PHOTO_BUCKET)
          .upload(photoPath, photo, { contentType: photo.type, upsert: false });
        if (uploadError) {
          setSendError("Photo couldn't be uploaded — this chat may have closed.");
          return;
        }
      }

      const { error } = await supabase
        .from("messages")
        .insert({ order_id: orderId, sender_id: currentUserId, body, photo_path: photoPath });
      if (error) {
        setSendError("Message couldn't be sent — this chat may have closed.");
        return;
      }
      setDraft("");
      setPhoto(null);
    });
  }

  const canSend = !sending && normalizeMessageBody(draft, photo !== null) !== null;

  return (
    <div data-testid="order-chat" className="mt-4 rounded-xl text-left" style={{ background: "var(--kb-cream)" }}>
      <p className="px-3 pt-3 text-xs font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
        Chat with {riderName?.trim() || "your rider"}
      </p>

      <div className="mt-2 max-h-56 space-y-2 overflow-y-auto px-3 py-2">
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
            No messages yet — say hi!
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === currentUserId;
          const url = m.photo_path ? photoUrls[m.photo_path] : undefined;
          return (
            <ChatBubble key={m.id} mine={mine} senderLabel={riderLabel} testId="chat-message">
              {m.photo_path &&
                (url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {/* Short-lived signed URL from a private bucket — next/image can't (and shouldn't) cache it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Attached photo" data-testid="chat-photo" className="max-h-48 w-full object-cover" />
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
          accept={ORDER_CHAT_PHOTO_TYPES.join(",")}
          onChange={handlePhotoPicked}
          className="hidden"
          aria-label="Attach photo"
          data-testid="chat-photo-input"
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
          placeholder="Type a message…"
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
