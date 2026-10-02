import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderRealtimeRefresher } from "@/components/OrderRealtimeRefresher";
import { CancelOrderButton } from "@/components/CancelOrderButton";
import { OrderProgress, type ProgressPosition } from "@/components/OrderProgress";
import { RiderCard, type RiderInfo } from "@/components/RiderCard";
import { OrderChat } from "@/components/OrderChat";
import { ProofOfDeliveryCard } from "@/components/ProofOfDeliveryCard";
import { ORDER_CHAT_PHOTO_BUCKET, ORDER_CHAT_PHOTO_URL_TTL_SECONDS, type MessageRow } from "@/lib/messages";
import { SupportChatToggle } from "@/components/SupportChat";
import { OrderRating, RateOrder } from "@/components/RateOrder";

export interface OrderRow {
  id: string;
  kitchen_id: string;
  subtotal: number;
  /** Absent on projects where schema section 18 hasn't run; null when no location was shared. */
  delivery_fee_estimate?: number | null;
  order_status: string;
  payment_status: string;
  preparation_status: string;
  created_at: string;
  decided_at: string | null;
  ready_at: string | null;
}

interface OrderItemRow {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface DeliveryRequestRow {
  status: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export interface Stage {
  message: string;
  at: string | null;
  tone: "warning" | "success" | "danger";
  /** Place on the progress bar (see ProgressPosition); null = cancelled/rejected. */
  position: ProgressPosition;
}

/**
 * Picks the delivery_requests row that represents visible progress to the
 * customer. A cook-ready order can have zero, one, or several requests over
 * time (e.g. a rider releases it back to open — `release_requested` — and a
 * different rider accepts next), but the customer only ever needs to know
 * about the one that got completed, or failing that the one currently
 * accepted. Anything else (open/cancelled/release_requested) still reads as
 * "looking for a rider" from the customer's side.
 */
export function pickActiveDelivery(deliveries: DeliveryRequestRow[]): DeliveryRequestRow | null {
  return deliveries.find((d) => d.status === "completed") ?? deliveries.find((d) => d.status === "accepted") ?? null;
}

/**
 * Maps order_status/preparation_status/delivery_requests to the single-line
 * stage message + timestamp the customer sees, per the locked stage list:
 * placed -> accepted+preparing -> ready -> rider assigned -> delivered, with
 * cancelled/rejected as terminal branches off of "placed". These stay
 * separate DB columns (locked business rule, docs/feature-001.md) but the
 * customer just wants one clear sentence and a "since when".
 */
export function getStage(order: OrderRow, activeDelivery: DeliveryRequestRow | null): Stage {
  if (order.order_status === "cancelled") {
    return { message: "Order was cancelled", at: order.decided_at, tone: "danger", position: null };
  }
  if (order.order_status === "rejected") {
    return { message: "Order was rejected", at: order.decided_at, tone: "danger", position: null };
  }
  if (activeDelivery?.status === "completed") {
    return { message: "Delivered", at: activeDelivery.completed_at, tone: "success", position: 3 };
  }
  if (activeDelivery?.status === "accepted") {
    return {
      message: "A rider has been assigned and is on the way to pick up your order",
      at: activeDelivery.accepted_at,
      tone: "success",
      position: 2,
    };
  }
  if (order.preparation_status === "ready") {
    // 1.5: Preparing is finished, the rider stage isn't reached yet.
    return { message: "Ready — looking for a rider", at: order.ready_at, tone: "success", position: 1.5 };
  }
  if (order.order_status === "accepted") {
    return { message: "Order confirmed — cook is preparing your food", at: order.decided_at, tone: "warning", position: 1 };
  }
  return { message: "Waiting for kitchen to accept", at: order.created_at, tone: "warning", position: -1 };
}

/**
 * Card header for the order's final state. Only active or successfully
 * completed orders get the green "Order placed!" check — a cancelled or
 * rejected order leads with a red X and says so, instead of celebrating an
 * order that will never be made.
 */
export function getHeader(orderStatus: string, kitchenName: string): { title: string; subtitle: string; failed: boolean } {
  if (orderStatus === "cancelled") {
    return { title: "Order cancelled", subtitle: "The kitchen won't prepare this order.", failed: true };
  }
  if (orderStatus === "rejected") {
    return { title: "Order declined", subtitle: `${kitchenName} couldn't take this order.`, failed: true };
  }
  return { title: "Order placed!", subtitle: `${kitchenName} has received your order.`, failed: false };
}

export function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  // Pin the zone: this renders on the server, whose local zone is UTC in production.
  return new Date(iso).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const STAGE_STYLE: Record<Stage["tone"], { background: string; color: string }> = {
  danger: { background: "rgba(239,68,68,0.12)", color: "var(--kb-danger)" },
  success: { background: "rgba(4,120,87,0.12)", color: "var(--kb-green-deep)" },
  warning: { background: "rgba(245,158,11,0.15)", color: "#92640A" },
};

function getPaynowInstruction(paynowType: string | null, paynowValue: string | null): string | null {
  if (!paynowType || !paynowValue) return null;
  return paynowType === "mobile" ? `Pay via PayNow to +65 ${paynowValue}` : `Pay via PayNow to UEN ${paynowValue}`;
}

function getPaymentMessage(
  paymentStatus: string,
  paynowType: string | null,
  paynowValue: string | null
): string {
  if (paymentStatus === "paid") return "Payment received";
  const paynowInstruction = getPaynowInstruction(paynowType, paynowValue);
  return paynowInstruction
    ? `Payment pending — ${paynowInstruction} once accepted`
    : "Payment pending — pay the cook via PayNow once accepted";
}

/**
 * Order confirmation — Feature #005, extended for cancellation + the full
 * status timeline. RLS on `orders` only lets a customer read their own rows,
 * so someone else's order id here just 404s rather than leaking that the
 * order exists.
 */
export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // select("*") rather than an explicit column list: `ready_at` is new (this
  // feature) and, on a project where docs/supabase-schema.sql's migration
  // hasn't been run yet, doesn't exist as a column at all — naming a
  // nonexistent column in an explicit select fails the whole query, whereas
  // `*` just omits it, so the page still works (minus that one timestamp)
  // until the migration is applied. Same pattern CookOrdersPanel already
  // uses in the Partner app.
  const [{ data: order }, { data: { user } }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).maybeSingle<OrderRow>(),
    supabase.auth.getUser(),
  ]);

  if (!order) notFound();

  const [{ data: kitchen }, { data: items }, { data: deliveries }, { count: supportMessageCount }] = await Promise.all([
    supabase
      .from("kitchens")
      .select("business_name, paynow_type, paynow_value")
      .eq("id", order.kitchen_id)
      .maybeSingle<{ business_name: string; paynow_type: string | null; paynow_value: string | null }>(),
    supabase.from("order_items").select("id, name, price, quantity").eq("order_id", id).order("id").returns<OrderItemRow[]>(),
    supabase
      .from("delivery_requests")
      .select("status, accepted_at, completed_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .returns<DeliveryRequestRow[]>(),
    // Only to decide whether the support chat starts open. If the
    // complaint_messages migration (schema §25) hasn't run, this errors ->
    // null -> "Report an issue" starts collapsed, same graceful degrade as
    // the rider card.
    supabase.from("complaint_messages").select("id", { count: "exact", head: true }).eq("order_id", id),
  ]);

  const activeDelivery = pickActiveDelivery(deliveries ?? []);
  const stage = getStage(order, activeDelivery);
  const stageTimestamp = formatTimestamp(stage.at);
  const header = getHeader(order.order_status, kitchen?.business_name ?? "The kitchen");

  // Rider name + photo, once a rider has accepted (or finished) the delivery.
  // profiles RLS hides other users' rows from customers, so this goes through
  // the get_order_rider() SECURITY DEFINER function, which the Partner app's
  // schema owns (its docs/supabase-schema.sql section 24; contract noted in
  // this repo's schema 20a). It returns name + photo only, only for this
  // customer's own order. If it isn't installed yet the call just errors ->
  // no rider card, and the rest of the page is unaffected.
  let rider: RiderInfo | null = null;
  if (activeDelivery && !header.failed) {
    const { data } = await supabase.rpc("get_order_rider", { p_order_id: id });
    // A set-returning function comes back as an array (supabase-js's untyped
    // rpc() doesn't know that, hence the cast).
    rider = (data as RiderInfo[] | null)?.[0] ?? null;
  }

  // Proof-of-delivery photo, once delivered. The chat is closed by then; RLS
  // still lets the customer read just this message and sign its photo (Partner
  // app's docs/supabase-messages.sql §7). If that migration hasn't run, the
  // is_delivery_proof filter errors -> no card, rest of the page unaffected.
  let proofPhotoUrl: string | null = null;
  if (activeDelivery?.status === "completed" && !header.failed) {
    const { data: proof } = await supabase
      .from("messages")
      .select("photo_path")
      .eq("order_id", id)
      .eq("is_delivery_proof", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Pick<MessageRow, "photo_path">>();
    if (proof?.photo_path) {
      const { data: signed } = await supabase.storage
        .from(ORDER_CHAT_PHOTO_BUCKET)
        .createSignedUrl(proof.photo_path, ORDER_CHAT_PHOTO_URL_TTL_SECONDS);
      proofPhotoUrl = signed?.signedUrl ?? null;
    }
  }

  // Rating (schema §31): only for a delivered order. `ratingLoaded` is false
  // if the ratings table doesn't exist yet — then show neither the picker
  // (it could only fail) nor a rating.
  const isDelivered = activeDelivery?.status === "completed" && !header.failed;
  let ratingLoaded = false;
  let myStars: number | null = null;
  if (isDelivered && user) {
    const { data, error } = await supabase.from("ratings").select("stars").eq("order_id", id).maybeSingle<{ stars: number }>();
    ratingLoaded = !error;
    myStars = data?.stars ?? null;
  }

  const deliveryFee = order.delivery_fee_estimate ?? null;
  const total = order.subtotal + (deliveryFee ?? 0);

  const isSettled =
    order.order_status === "cancelled" || order.order_status === "rejected" || activeDelivery?.status === "completed";

  // Same window the messages table's order_chat_participant() RLS check
  // enforces (accepted delivery, order not cancelled/rejected) — see
  // docs/messages.md. Mirroring it here just controls whether the chat box
  // renders at all; RLS is what actually protects the rows.
  const chatVisible = Boolean(user) && activeDelivery?.status === "accepted" && !header.failed;

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)", color: "var(--kb-on-navy)" }}>
      <OrderRealtimeRefresher orderId={order.id} isSettled={isSettled} />
      <div className="mx-auto max-w-sm">
        <div className="rounded-2xl bg-white p-6 text-center shadow-lg" style={{ color: "var(--kb-ink)" }}>
          <div
            data-testid="order-header-icon"
            data-failed={header.failed}
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: header.failed ? "var(--kb-danger)" : "var(--kb-green-deep)" }}
          >
            {header.failed ? <CrossIcon /> : <CheckIcon />}
          </div>
          <h1 className="mt-4 font-display text-xl font-bold">{header.title}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--kb-ink-soft)" }}>
            {header.subtitle}
          </p>

          <OrderProgress position={stage.position} />

          <p
            className="mt-4 inline-block rounded-full px-3 py-1 text-xs font-semibold"
            style={STAGE_STYLE[stage.tone]}
          >
            {stage.message}
          </p>
          {stageTimestamp && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--kb-ink-soft)" }}>
              {stageTimestamp}
            </p>
          )}
          {rider && <RiderCard rider={rider} />}
          {proofPhotoUrl && (
            <ProofOfDeliveryCard photoUrl={proofPhotoUrl} deliveredAt={formatTimestamp(activeDelivery?.completed_at ?? null)} />
          )}
          {ratingLoaded && (myStars != null ? <OrderRating stars={myStars} /> : <RateOrder orderId={order.id} />)}
          {chatVisible && <OrderChat orderId={order.id} currentUserId={user!.id} riderName={rider?.full_name ?? null} />}
          {/* A cancelled/rejected order will never be accepted or paid for, so
              "pay via PayNow once accepted" would be wrong — hide the line. */}
          {!header.failed && (
            <p className="mt-1.5 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
              {getPaymentMessage(order.payment_status, kitchen?.paynow_type ?? null, kitchen?.paynow_value ?? null)}
            </p>
          )}

          {order.order_status === "placed" && <CancelOrderButton orderId={order.id} />}

          <div className="mt-5 space-y-2 text-left">
            {(items ?? []).map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>
                  {item.quantity}&times; {item.name}
                </span>
                <span>${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Same labels/styling as the cart page (CartView). */}
          <div className="mt-4 space-y-2 border-t pt-3 text-left" style={{ borderColor: "var(--kb-cream)" }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">Subtotal</span>
              <span className="font-semibold">${order.subtotal.toFixed(2)}</span>
            </div>
            {deliveryFee != null && (
              <div className="flex items-center justify-between text-sm" style={{ color: "var(--kb-ink-soft)" }}>
                <span>Estimated delivery fee</span>
                <span>${deliveryFee.toFixed(2)}</span>
              </div>
            )}
            <div
              data-testid="order-total"
              className="flex items-center justify-between border-t pt-2 font-bold"
              style={{ borderColor: "var(--kb-cream)" }}
            >
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>

          {/* Unlike the rider chat there's no window: a complaint can be
              raised at any stage and the thread stays as the record. */}
          {user && <SupportChatToggle orderId={order.id} currentUserId={user.id} hasThread={(supportMessageCount ?? 0) > 0} />}

          <Link
            href="/"
            className="mt-3 inline-block w-full rounded-xl py-2.5 text-sm font-semibold text-white"
            style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
          >
            Back to marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}

function CrossIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 12 9 17 20 6" />
    </svg>
  );
}
