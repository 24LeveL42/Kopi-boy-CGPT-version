"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The order confirmation page is a Server Component that fetches order
 * status once, at request time — so an already-open tab needs telling when
 * the cook/rider acts. This subscribes to Supabase Realtime for this one
 * order (its `orders` row and its `delivery_requests` rows) and calls
 * `router.refresh()` the moment either changes — replacing the old
 * OrderStatusPoller's 5-second polling. RLS means the customer only receives
 * changes to their own order. Unsubscribes once the order is settled.
 *
 * Safety net: if the channel can't be established (Realtime down, or the
 * publication section of docs/supabase-schema.sql hasn't been run yet), it
 * falls back to the old interval refresh until the channel is up, so the page
 * never silently stops updating. Also refreshes on every (re)connect to catch
 * any change that landed between the server render and the subscription, or
 * while the socket was down.
 */
export function OrderRealtimeRefresher({
  orderId,
  isSettled,
  fallbackIntervalMs = 5000,
}: {
  orderId: string;
  isSettled: boolean;
  fallbackIntervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (isSettled) return;

    const supabase = createClient();
    let disposed = false;
    let fallback: ReturnType<typeof setInterval> | null = null;

    const startFallback = () => {
      if (!fallback) fallback = setInterval(() => router.refresh(), fallbackIntervalMs);
    };
    const stopFallback = () => {
      if (fallback) clearInterval(fallback);
      fallback = null;
    };

    const channel = supabase
      .channel(`order:${orderId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, () =>
        router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_requests", filter: `order_id=eq.${orderId}` },
        () => router.refresh()
      )
      .subscribe((status) => {
        if (disposed) return; // our own removeChannel() below reports CLOSED
        if (status === "SUBSCRIBED") {
          stopFallback();
          router.refresh();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startFallback();
        }
      });

    return () => {
      disposed = true;
      stopFallback();
      supabase.removeChannel(channel);
    };
  }, [orderId, isSettled, fallbackIntervalMs, router]);

  return null;
}
