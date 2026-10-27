"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideMyOrder, hideAllMyPastOrders } from "@/lib/order-actions";
import { Spinner } from "@/components/Spinner";

/** Shown before either action — the customer must know nothing is deleted. */
export const HIDE_ORDERS_CONFIRM = "This only removes them from your list. Kitchens keep their records.";

/**
 * Shared by "Remove" (one finished order) and "Clear all past orders".
 * Same Server Action pattern as CancelOrderButton: startTransition, a
 * returned { ok, message } instead of a thrown error, router.refresh() so
 * the server-rendered list drops the hidden orders.
 */
function useHideOrders(run: () => ReturnType<typeof hideAllMyPastOrders>, failMessage: string) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm(HIDE_ORDERS_CONFIRM)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) setError(result.message);
        router.refresh();
      } catch {
        setError(failMessage);
        router.refresh();
      }
    });
  }

  return { isPending, error, handleClick };
}

function HideError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(239,68,68,0.12)", color: "var(--kb-danger)" }}>
      {message}
    </p>
  );
}

/** "Remove" on one finished order's card. Only rendered for finished orders. */
export function RemoveOrderButton({ orderId }: { orderId: string }) {
  const { isPending, error, handleClick } = useHideOrders(
    () => hideMyOrder(orderId),
    "Couldn't remove this order — please try again."
  );

  return (
    <div className="mt-3 border-t pt-2.5" style={{ borderColor: "#eceaf1" }}>
      {error && <div className="mb-2"><HideError message={error} /></div>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          data-testid="remove-order"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold disabled:opacity-60"
          style={{ color: "var(--kb-danger)" }}
        >
          {isPending && <Spinner size={12} />}
          {isPending ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}

/** "Clear all past orders" under the list. Hides every finished order, also ones beyond the 10 shown. */
export function ClearPastOrdersButton() {
  const { isPending, error, handleClick } = useHideOrders(
    () => hideAllMyPastOrders(),
    "Couldn't clear your past orders — please try again."
  );

  return (
    <div className="mt-4">
      {error && <div className="mb-2"><HideError message={error} /></div>}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        data-testid="clear-past-orders"
        className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold disabled:opacity-60"
        style={{ borderColor: "var(--kb-danger)", color: "var(--kb-danger)" }}
      >
        {isPending && <Spinner />}
        {isPending ? "Clearing…" : "Clear all past orders"}
      </button>
    </div>
  );
}
