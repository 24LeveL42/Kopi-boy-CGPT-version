"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rateOrder } from "@/lib/order-actions";
import { Spinner } from "@/components/Spinner";

/**
 * "Rate this order" — tap a star (1-5) to submit straight away, no confirm
 * step. Shown by the order page only once the order is delivered and not yet
 * rated; after a successful save the page refreshes and shows <OrderRating>
 * instead. Same startTransition + result-object pattern as CancelOrderButton.
 */
export function RateOrder({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hovered, setHovered] = useState(0);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function submit(stars: number) {
    setPicked(stars);
    setError(null);
    startTransition(async () => {
      try {
        const result = await rateOrder(orderId, stars);
        if (!result.ok) {
          setError(result.message);
          setPicked(0);
        }
        router.refresh();
      } catch {
        setError("Couldn't save your rating — please try again.");
        setPicked(0);
      }
    });
  }

  const lit = hovered || picked;

  return (
    <div className="mt-4 rounded-xl p-3" style={{ background: "var(--kb-cream)" }}>
      <p className="text-sm font-semibold">Rate this order</p>
      <div className="mt-1.5 flex items-center justify-center gap-1" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => submit(n)}
            onMouseEnter={() => setHovered(n)}
            disabled={isPending}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className="p-0.5 disabled:opacity-60"
          >
            <Star filled={n <= lit} size={30} />
          </button>
        ))}
        {isPending && <Spinner />}
      </div>
      {error && (
        <p className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.12)", color: "var(--kb-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** The customer's own saved rating, read-only. */
export function OrderRating({ stars }: { stars: number }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2 text-sm" data-testid="order-rating">
      <span style={{ color: "var(--kb-ink-soft)" }}>You rated this order</span>
      <span className="flex" aria-label={`${stars} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} filled={n <= stars} size={16} />
        ))}
      </span>
    </div>
  );
}

function Star({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "var(--kb-warn)" : "none"} stroke="var(--kb-warn)" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
