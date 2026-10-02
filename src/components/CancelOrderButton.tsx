"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelOrder } from "@/lib/order-actions";
import { Spinner } from "@/components/Spinner";

/**
 * Invokes cancelOrder() (a Server Action) via startTransition, per this
 * repo's own Next.js docs (node_modules/next/dist/docs/01-app/02-guides/
 * server-actions.md) — same pattern CartView already uses for placeOrder().
 *
 * cancelOrder() returns { ok, message } rather than throwing for its
 * expected failure case: Next.js redacts a thrown Error's message from a
 * Server Action in production (replaced with a generic "Minified React
 * error" digest), so relying on a caught exception's `.message` here would
 * show that digest instead of the real "kitchen already responded" text.
 * The try/catch below is just a fallback for a genuinely unexpected
 * exception (e.g. a network failure before the action even runs).
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    if (!window.confirm("Cancel this order? The kitchen won't prepare it.")) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelOrder(orderId);
        if (!result.ok) {
          // Can legitimately happen if the kitchen decided in the time
          // since this page last polled — refresh either way so the stage
          // message and this button catch up to reality instead of
          // leaving a stale "Cancel order" button next to the error.
          setError(result.message);
        }
        router.refresh();
      } catch {
        setError("Couldn't cancel this order — please try again.");
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4">
      {error && (
        <p className="mb-2 rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.12)", color: "var(--kb-danger)" }}>
          {error}
        </p>
      )}
      <button
        onClick={handleCancel}
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold disabled:opacity-60"
        style={{ borderColor: "var(--kb-danger)", color: "var(--kb-danger)" }}
      >
        {isPending && <Spinner />}
        {isPending ? "Cancelling…" : "Cancel order"}
      </button>
    </div>
  );
}
