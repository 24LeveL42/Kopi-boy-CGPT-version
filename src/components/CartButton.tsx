"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart-context";

/**
 * Cart icon + item-count badge in the universal PageChrome bar, so the cart
 * is one tap away from every route (not just the kitchen it was filled
 * from). Always shown — an empty cart still links to /cart — with the badge
 * only once there's something in it.
 */
export function CartButton() {
  const { itemCount } = useCart();
  const label = itemCount > 0 ? `Cart, ${itemCount} ${itemCount === 1 ? "item" : "items"}` : "Cart";

  return (
    <Link
      href="/cart"
      aria-label={label}
      className="relative flex items-center justify-center rounded-full p-2"
      style={{ color: "var(--kb-on-navy)" }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="21" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="19" cy="21" r="1.5" fill="currentColor" stroke="none" />
        <path d="M2.5 3h2l2.4 12.4a2 2 0 002 1.6h8.2a2 2 0 002-1.7L21 8H6" />
      </svg>
      {itemCount > 0 && (
        <span
          data-testid="cart-badge"
          className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
          style={{ background: "var(--kb-danger)" }}
        >
          {itemCount > 99 ? "99+" : itemCount}
        </span>
      )}
    </Link>
  );
}
