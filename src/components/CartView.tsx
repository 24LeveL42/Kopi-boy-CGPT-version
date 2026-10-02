"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/lib/cart-context";
import { placeOrder } from "@/lib/order-actions";
import { useCustomerLocation } from "@/lib/use-customer-location";
import { haversineDistanceKm, estimateDeliveryFee } from "@/lib/distance";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/Spinner";

export function CartView({ isSignedIn }: { isSignedIn: boolean }) {
  const { cart, setQuantity, removeItem, subtotal, clearCart } = useCart();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { coords, status: locationStatus, requestLocation } = useCustomerLocation();
  const [kitchenCoords, setKitchenCoords] = useState<{ latitude: number | null; longitude: number | null } | null>(
    null
  );

  // Fetched fresh at checkout (not carried in the cart) so the fee estimate
  // reflects the kitchen's current coordinates.
  useEffect(() => {
    if (!cart) return;
    let cancelled = false;
    createClient()
      .from("kitchens")
      .select("latitude, longitude")
      .eq("id", cart.kitchenId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setKitchenCoords(data ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [cart]);

  const distanceKm =
    coords && kitchenCoords?.latitude != null && kitchenCoords?.longitude != null
      ? haversineDistanceKm(coords.latitude, coords.longitude, kitchenCoords.latitude, kitchenCoords.longitude)
      : null;
  const deliveryFeeEstimate = distanceKm != null ? estimateDeliveryFee(distanceKm) : null;

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)", color: "var(--kb-on-navy)" }}>
        <div className="mx-auto max-w-sm text-center">
          <h1 className="font-display text-xl font-bold">Your cart</h1>
          <p className="mt-4" style={{ color: "var(--kb-on-navy-soft)" }}>
            Your cart is empty.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
          >
            Browse merchants
          </Link>
        </div>
      </div>
    );
  }

  function handlePlaceOrder() {
    if (!cart) return;
    setError(null);
    startTransition(async () => {
      try {
        const { orderId } = await placeOrder(
          cart.kitchenId,
          cart.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
          coords
        );
        clearCart();
        router.push(`/orders/${orderId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong — please try again.");
      }
    });
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "var(--kb-navy)", color: "var(--kb-on-navy)" }}>
      <div className="mx-auto max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold">Your cart</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--kb-on-navy-soft)" }}>
              {cart.kitchenName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              // Confirmed, unlike the per-line remove: this throws away the whole order in one tap.
              if (window.confirm("Remove everything from your cart?")) clearCart();
            }}
            className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--kb-navy-line)", color: "var(--kb-on-navy)" }}
          >
            Clear all
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {cart.items.map((item) => (
            <div
              key={item.menuItemId}
              className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow"
              style={{ color: "var(--kb-ink)" }}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                <p className="text-sm" style={{ color: "var(--kb-ink-soft)" }}>
                  ${item.price.toFixed(2)} each
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  aria-label={`Decrease ${item.name} quantity`}
                  onClick={() => setQuantity(item.menuItemId, item.quantity - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
                  style={{ background: "var(--kb-cream)" }}
                >
                  &minus;
                </button>
                <span className="w-4 text-center text-sm font-semibold">{item.quantity}</span>
                <button
                  aria-label={`Increase ${item.name} quantity`}
                  onClick={() => setQuantity(item.menuItemId, item.quantity + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: "var(--kb-green-deep)" }}
                >
                  +
                </button>
                <button
                  aria-label={`Remove ${item.name} from cart`}
                  onClick={() => removeItem(item.menuItemId)}
                  className="ml-1 flex h-7 w-7 items-center justify-center rounded-full"
                  style={{ color: "var(--kb-danger)" }}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl bg-white p-4 shadow" style={{ color: "var(--kb-ink)" }}>
          {!coords && (
            <div className="mb-3">
              <button
                type="button"
                onClick={requestLocation}
                disabled={locationStatus === "locating"}
                className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium disabled:opacity-60"
                style={{ borderColor: "#E5E7EB", color: "var(--kb-purple)" }}
              >
                {locationStatus === "locating" && <Spinner />}
                {locationStatus === "locating" ? "Getting your location…" : "Use my current location"}
              </button>
              {locationStatus === "denied" && (
                <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                  Location permission was denied — no problem, you can still place your order. We just
                  won&apos;t be able to estimate the delivery fee up front.
                </p>
              )}
              {locationStatus === "unavailable" && (
                <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                  Couldn&apos;t get your location right now — no problem, this is optional and won&apos;t stop
                  your order.
                </p>
              )}
              {locationStatus === "unsupported" && (
                <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                  Your browser doesn&apos;t support location detection — no problem, this is optional.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="font-semibold">Subtotal</span>
            <span className="font-semibold">${subtotal.toFixed(2)}</span>
          </div>

          {deliveryFeeEstimate != null && (
            <>
              <div className="mt-2 flex items-center justify-between text-sm" style={{ color: "var(--kb-ink-soft)" }}>
                <span>Estimated delivery fee</span>
                <span>${deliveryFeeEstimate.toFixed(2)}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--kb-ink-soft)" }}>
                Estimate only, based on distance — the cook and rider confirm the actual fee between
                themselves. Not collected by Kopi Boy; pay the cook directly via PayNow once accepted.
              </p>
            </>
          )}
        </div>

        {isSignedIn ? (
          <>
            <button
              onClick={handlePlaceOrder}
              disabled={pending}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
            >
              {pending && <Spinner />}
              {pending ? "Placing order…" : "Place order"}
            </button>
            {error && (
              <p className="mt-2 text-sm" style={{ color: "var(--kb-danger)" }}>
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="mt-5 rounded-xl bg-white p-4 text-center shadow" style={{ color: "var(--kb-ink)" }}>
            <p style={{ color: "var(--kb-ink-soft)" }}>Sign in to place your order.</p>
            <Link
              href="/login"
              className="mt-3 inline-block w-full rounded-xl py-2.5 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(90deg, var(--kb-purple) 0%, var(--kb-green) 100%)" }}
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}
