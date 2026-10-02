"use client";

import { useState } from "react";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";

export function MenuItemRow({
  kitchenId,
  kitchenName,
  item,
}: {
  kitchenId: string;
  kitchenName: string;
  item: { id: string; name: string; price: number; photo_url: string | null };
}) {
  const { cart, addItem, setQuantity } = useCart();
  const [showDetail, setShowDetail] = useState(false);
  const quantity = cart?.kitchenId === kitchenId ? cart.items.find((i) => i.menuItemId === item.id)?.quantity ?? 0 : 0;

  const quantityControl =
    quantity === 0 ? (
      <button
        onClick={() => addItem(kitchenId, kitchenName, { menuItemId: item.id, name: item.name, price: item.price })}
        className="shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold text-white"
        style={{ background: "var(--kb-green-deep)" }}
      >
        Add
      </button>
    ) : (
      <div className="flex shrink-0 items-center gap-2">
        <button
          aria-label={`Decrease ${item.name} quantity`}
          onClick={() => setQuantity(item.id, quantity - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: "var(--kb-cream)" }}
        >
          &minus;
        </button>
        <span className="w-4 text-center text-sm font-semibold">{quantity}</span>
        <button
          aria-label={`Increase ${item.name} quantity`}
          onClick={() => setQuantity(item.id, quantity + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ background: "var(--kb-green-deep)" }}
        >
          +
        </button>
      </div>
    );

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow" style={{ color: "var(--kb-ink)" }}>
        <button
          type="button"
          onClick={() => setShowDetail(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {item.photo_url && (
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
              <Image src={item.photo_url} alt="" fill sizes="48px" className="object-cover" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.name}</p>
            <p className="text-sm" style={{ color: "var(--kb-ink-soft)" }}>
              ${(item.price * Math.max(quantity, 1)).toFixed(2)}
              {quantity > 1 && <span className="text-xs"> (${item.price.toFixed(2)} each)</span>}
            </p>
          </div>
        </button>

        {quantityControl}
      </div>

      {showDetail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={item.name}
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={() => setShowDetail(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl"
            style={{ color: "var(--kb-ink)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {item.photo_url ? (
              <div className="relative h-64 w-full">
                <Image
                  src={item.photo_url}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 384px, 100vw"
                  className="object-cover"
                  priority
                />
              </div>
            ) : null}

            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-semibold">{item.name}</h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setShowDetail(false)}
                  className="shrink-0 rounded-full p-1 text-xl leading-none"
                  style={{ color: "var(--kb-ink-soft)" }}
                >
                  &times;
                </button>
              </div>
              <p className="mt-1 text-base font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
                ${(item.price * Math.max(quantity, 1)).toFixed(2)}
                {quantity > 1 && <span className="text-sm font-normal"> (${item.price.toFixed(2)} each)</span>}
              </p>

              <div className="mt-5 flex justify-end">{quantityControl}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
