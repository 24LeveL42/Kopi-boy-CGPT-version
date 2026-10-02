# Kopi Boy 2.0

Singapore food-delivery marketplace for home cooks, hawkers, and small food
businesses — zero food-order commission. Full business model in
[`/docs/feature-001.md`](./docs/feature-001.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Vitest + Testing
Library. Supabase (Postgres/Auth/Storage) and Vercel hosting come in with
Feature #002+ per the build sequence below.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm test         # vitest, single run
npm run lint
```

## Current status: Feature #005 — Cart + order creation

Done:
- Project foundation (Next.js, TypeScript, Tailwind, ESLint)
- Global design system (`src/app/globals.css` — brand tokens, no hard-coded
  hex outside that file)
- Responsive customer marketplace (`/`) — search, category filter, merchant
  grid, "Popular Near You" — reads real live kitchens from Supabase via
  `src/lib/kitchens.ts`, not demo data (see `docs/feature-003.md`)
- Merchant profile route (`/merchant/[id]`) — reads the real `kitchens` row
  and now renders its menu with Add-to-cart controls (see `docs/feature-005.md`)
- Cart (`/cart`) — client-side, single-kitchen, `localStorage`-backed — and
  checkout, which creates a real `orders` row (`status = 'placed'`) plus its
  `order_items`, then lands on an order confirmation screen (`/orders/[id]`)
- Auth: phone OTP (Vonage) + Google Sign-In, `/login`, `/account`
- In-app notifications — bell + unread badge, live toast and `/notifications`
  inbox, driven by Supabase Realtime; the order page also updates live instead
  of polling (see `docs/notifications.md`; needs the last section of
  `docs/supabase-schema.sql` run once)
- Testing — Vitest + Testing Library (search/filter logic, order status,
  cancellation, notifications + Realtime behaviour)

Not done yet (by design — see build sequence):
- PayNow, cook accept/reject, delivery, ratings, complaints, admin —
  Features #006-#011. `rating`/`distanceKm`/`etaMinutes` on real merchants
  are fixed placeholders until #007 (delivery fee) and #009 (ratings) exist.
- Order history for the customer — only the single post-checkout
  confirmation screen exists; the `BottomNav` "Orders" tab is still disabled.

## Build sequence

001 Foundation + marketplace (done) -> 002 Auth + roles (done) -> 003
Merchant onboarding (kitchen/menu setup done in Partner app + live read here;
see `docs/feature-003.md`) -> 004 Merchant profile + menu -> 005 Cart + order
creation ->
006 Cook accept/reject + PayNow -> 007 Delivery fee engine -> 008 Rider
workflow -> 009 Ratings -> 010 Complaints + refunds -> 011 Admin Control
Center -> 012 Testing + deployment hardening.
