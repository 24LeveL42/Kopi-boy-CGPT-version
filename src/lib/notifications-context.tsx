"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { countUnread, mergeNotifications, NOTIFICATION_LIMIT, type NotificationRow } from "@/lib/notifications";

/** `idle` = auth state not known yet (first render); `signed-out` = no user. */
export type NotificationsStatus = "idle" | "loading" | "ready" | "error" | "signed-out";

export const TOAST_DURATION_MS = 6000;
const MAX_TOASTS = 3;

interface NotificationsContextValue {
  status: NotificationsStatus;
  notifications: NotificationRow[];
  unreadCount: number;
  /** Notifications that just arrived live and are still on screen as toasts. */
  toasts: NotificationRow[];
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismissToast: (id: string) => void;
  reload: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return ctx;
}

/**
 * Live customer notifications, in-app only (no push/service worker — nothing
 * arrives while the tab is closed). The rows are created by database triggers
 * (docs/supabase-schema.sql §21-24) when the cook/rider moves an order; this
 * provider just streams the signed-in customer's own rows over Supabase
 * Realtime (`postgres_changes` on `notifications`, filtered to their user id,
 * and RLS means they can't receive anyone else's anyway) and exposes them to
 * the bell, the toast and the inbox page.
 *
 * Ordering: subscribe first, then fetch on SUBSCRIBED — so a row inserted
 * between "fetch" and "subscribe" can't be missed; anything that arrives both
 * ways is de-duplicated by id. The same fetch runs again on a reconnect, which
 * is how notifications that arrived while the socket was down show up.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<NotificationsStatus>("idle");
  const [notifications, setNotificationsState] = useState<NotificationRow[]>([]);
  const [toasts, setToasts] = useState<NotificationRow[]>([]);

  // The list lives in a ref as well as state so markRead/markAllRead can read
  // the current value synchronously — deciding whether to hit the database
  // from inside a setState updater is unreliable (React may run it later).
  const notificationsRef = useRef<NotificationRow[]>([]);
  // `undefined` = auth not resolved yet, `null` = resolved and signed out. The
  // distinction matters: the very first auth event for a logged-out visitor is
  // "no user", which must still move status off `idle` to `signed-out`.
  const userIdRef = useRef<string | null | undefined>(undefined);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const toastTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const applyNotifications = useCallback((update: (prev: NotificationRow[]) => NotificationRow[]) => {
    const next = update(notificationsRef.current);
    notificationsRef.current = next;
    setNotificationsState(next);
  }, []);

  const clearToasts = useCallback(() => {
    toastTimers.current.forEach((t) => clearTimeout(t));
    toastTimers.current.clear();
    setToasts([]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (n: NotificationRow) => {
      setToasts((prev) => [n, ...prev.filter((t) => t.id !== n.id)].slice(0, MAX_TOASTS));
      const existing = toastTimers.current.get(n.id);
      if (existing) clearTimeout(existing);
      toastTimers.current.set(
        n.id,
        setTimeout(() => dismissToast(n.id), TOAST_DURATION_MS)
      );
    },
    [dismissToast]
  );

  const load = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_LIMIT);
    if (userIdRef.current !== userId) return; // signed out / switched user mid-fetch
    if (error) {
      setStatus("error");
      return;
    }
    applyNotifications((prev) => mergeNotifications(prev, (data ?? []) as NotificationRow[]));
    setStatus("ready");
  }, [supabase, applyNotifications]);

  useEffect(() => {
    function teardown() {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    }

    function start(userId: string) {
      setStatus("loading");
      let loadedWithoutRealtime = false;
      const channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as NotificationRow;
            applyNotifications((prev) => mergeNotifications(prev, [row]));
            showToast(row);
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            // Keeps read state in sync across this customer's other tabs/devices.
            const row = payload.new as NotificationRow;
            applyNotifications((prev) => mergeNotifications(prev, [row]));
          }
        )
        .subscribe((subscribeStatus) => {
          if (subscribeStatus === "SUBSCRIBED") {
            void load();
          } else if ((subscribeStatus === "CHANNEL_ERROR" || subscribeStatus === "TIMED_OUT") && !loadedWithoutRealtime) {
            // Realtime is unavailable; still show whatever the database has.
            loadedWithoutRealtime = true;
            void load();
          }
        });
      channelRef.current = channel;
    }

    // Auth-js fires INITIAL_SESSION right after subscribing, SIGNED_IN /
    // SIGNED_OUT afterwards (and SIGNED_IN again on tab refocus — hence the
    // userId comparison). Supabase calls made *inside* this callback can
    // deadlock auth-js's lock, so the real work is deferred with setTimeout.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      if (userId === userIdRef.current) return;
      userIdRef.current = userId;
      setTimeout(() => {
        if (userIdRef.current !== userId) return;
        teardown();
        clearToasts();
        applyNotifications(() => []);
        if (userId) start(userId);
        else setStatus("signed-out");
      }, 0);
    });

    return () => {
      subscription.unsubscribe();
      userIdRef.current = undefined;
      teardown();
      clearToasts();
    };
  }, [supabase, load, showToast, clearToasts, applyNotifications]);

  const markRead = useCallback(
    async (id: string) => {
      dismissToast(id);
      const target = notificationsRef.current.find((n) => n.id === id);
      if (!target || target.read_at) return;
      const now = new Date().toISOString();
      applyNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: now } : n)));
      const { error } = await supabase.from("notifications").update({ read_at: now }).eq("id", id).is("read_at", null);
      if (error) {
        applyNotifications((prev) => prev.map((n) => (n.id === id && n.read_at === now ? { ...n, read_at: null } : n)));
      }
    },
    [supabase, dismissToast, applyNotifications]
  );

  const markAllRead = useCallback(async () => {
    clearToasts();
    const unreadIds = new Set(notificationsRef.current.filter((n) => !n.read_at).map((n) => n.id));
    if (unreadIds.size === 0) return;
    const now = new Date().toISOString();
    applyNotifications((prev) => prev.map((n) => (unreadIds.has(n.id) ? { ...n, read_at: now } : n)));
    const { error } = await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
    if (error) {
      applyNotifications((prev) => prev.map((n) => (unreadIds.has(n.id) && n.read_at === now ? { ...n, read_at: null } : n)));
    }
  }, [supabase, clearToasts, applyNotifications]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      status,
      notifications,
      unreadCount: countUnread(notifications),
      toasts,
      markRead,
      markAllRead,
      dismissToast,
      reload: load,
    }),
    [status, notifications, toasts, markRead, markAllRead, dismissToast, load]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
