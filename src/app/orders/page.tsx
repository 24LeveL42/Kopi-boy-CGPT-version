import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/BottomNav";
import {
  formatTimestamp,
  getStage,
  pickActiveDelivery,
  STAGE_STYLE,
  type DeliveryRequestRow,
  type OrderRow,
} from "./[id]/page";

export const metadata: Metadata = {
  title: "My orders — Kopi Boy",
};

/** How many orders the history shows — the same 10 the archive trigger keeps (schema §27). */
const ORDER_HISTORY_LIMIT = 10;

export interface OrderListRow extends OrderRow {
  kitchens: { business_name: string } | null;
  delivery_requests: DeliveryRequestRow[] | null;
}

/**
 * Order history: the customer's 10 most recent orders, newest first, each
 * linking to /orders/[id].
 *
 * Archived orders (customer_archived_at set by the trigger in schema §27) are
 * filtered out HERE, not by RLS — an archived order still opens by direct
 * link, e.g. from an old notification. The status line reuses the order
 * page's getStage(), so the list and the order page never disagree.
 */
export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let orders: OrderListRow[] = [];
  let loadFailed = false;
  if (user) {
    // "*" for the same reason as the order page (tolerates not-yet-migrated
    // columns). kitchens is null when the kitchen has since gone offline
    // (kitchens RLS only shows live ones to customers).
    const query = () =>
      supabase
        .from("orders")
        .select("*, kitchens(business_name), delivery_requests(status, accepted_at, completed_at)")
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false })
        .limit(ORDER_HISTORY_LIMIT);

    let { data, error } = await query().is("customer_archived_at", null).returns<OrderListRow[]>();
    // 42703 = undefined column: the §27 migration hasn't run on this project
    // yet, so nothing is archived — the unfiltered newest 10 is the same list.
    if (error?.code === "42703") ({ data, error } = await query().returns<OrderListRow[]>());
    orders = data ?? [];
    loadFailed = Boolean(error);
  }

  return (
    <div className="min-h-screen px-4 pb-28 pt-8 sm:px-6" style={{ background: "var(--kb-navy)", color: "var(--kb-on-navy)" }}>
      <div className="mx-auto max-w-sm">
        <h1 className="font-display text-xl font-bold">My orders</h1>

        {!user ? (
          <div className="mt-6 rounded-2xl bg-white p-5 text-center shadow-lg" style={{ color: "var(--kb-ink)" }}>
            <p style={{ color: "var(--kb-ink-soft)" }}>Sign in to see your orders.</p>
            <Link
              href="/login"
              className="mt-4 inline-block w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
            >
              Sign in
            </Link>
          </div>
        ) : loadFailed ? (
          <p className="mt-6 rounded-2xl bg-white p-5 text-sm shadow-lg" style={{ color: "var(--kb-danger)" }}>
            Couldn&apos;t load your orders — please try again.
          </p>
        ) : orders.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-white p-5 text-center shadow-lg" style={{ color: "var(--kb-ink)" }}>
            <p style={{ color: "var(--kb-ink-soft)" }}>No orders yet.</p>
            <Link
              href="/"
              className="mt-4 inline-block w-full rounded-xl py-3 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
            >
              Browse merchants
            </Link>
          </div>
        ) : (
          <>
            <ul className="mt-5 space-y-3">
              {orders.map((order) => {
                const stage = getStage(order, pickActiveDelivery(order.delivery_requests ?? []));
                return (
                  <li key={order.id}>
                    <Link
                      href={`/orders/${order.id}`}
                      data-testid="order-history-row"
                      className="block rounded-2xl bg-white p-4 shadow-lg"
                      style={{ color: "var(--kb-ink)" }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{order.kitchens?.business_name ?? "Kitchen"}</p>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                            {formatTimestamp(order.created_at)}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold">${order.subtotal.toFixed(2)}</span>
                      </div>
                      <p className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={STAGE_STYLE[stage.tone]}>
                        {stage.message}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-center text-xs" style={{ color: "var(--kb-on-navy-soft)" }}>
              Showing your {ORDER_HISTORY_LIMIT} most recent orders.
            </p>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
