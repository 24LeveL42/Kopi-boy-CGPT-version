# Feature #001 — Foundation + Customer Marketplace

## Scope

Project foundation, global design system, and a browsable customer
marketplace. No auth, no real backend, no order flow yet — those are later
features (see README build sequence).

## Locked business rules this feature must not contradict

(Full detail is in the Product Owner's handover doc — summarized here so
later features don't have to re-derive it.)

- Zero food-order commission; merchant revenue is a flat monthly
  subscription, TBD amount.
- Riders: free registration, no fees, approved by Kopi Boy before accepting
  deliveries, cook selects the rider (not auto-dispatch).
- Customer does not pay at order placement — cook must accept first, then
  customer pays the cook directly via PayNow (no in-app payment gateway in
  v1).
- Delivery fee is distance-based, belongs 100% to the rider, cook pays
  rider on pickup.
- Order/payment/preparation/delivery/incident are separate status fields,
  not one combined enum (see `docs/feature-001.md` companion note in code
  comments — modeled properly starting Feature #005).
- Scope is food delivery only. No taxi/PHV in this codebase.

## Files

| File | Purpose |
|---|---|
| `src/app/globals.css` | Design tokens (brand colors, fonts) as CSS variables + Tailwind `@theme inline`. Single source of truth for the palette. |
| `src/app/layout.tsx` | Root layout, page metadata. |
| `src/app/page.tsx` | Marketplace home route — passes demo data into `<Marketplace>`. |
| `src/app/merchant/[id]/page.tsx` | Merchant profile route scaffold (stable URLs now, full UI later). |
| `src/components/Marketplace.tsx` | Client component: owns search + category state, exports `filterMerchants()` (unit tested). |
| `src/components/SearchBar.tsx` | Search input. |
| `src/components/CategoryNav.tsx` | Category filter pills (All / Home Cooks / Hawkers / Bakery / Small Business). |
| `src/components/MerchantCard.tsx`, `MerchantGrid.tsx` | Marketplace grid + card, responsive 2→5 columns, empty state. |
| `src/components/Logo.tsx` | Coded approximation of the approved KB gradient logomark — **swap for the real exported logo asset when available.** |
| `src/lib/types.ts` | `Merchant`, `MerchantCategory`, `CategoryDef` types — marketplace scope only. |
| `src/lib/demo-data.ts` | 10 realistic SG merchants across all four categories. Clearly commented as demo-only. |
| `tests/filter-merchants.test.ts` | 7 tests covering category filter, text search (name/cuisine/neighbourhood/menu item), and combined filters. |

## Known placeholders (intentional, not gaps to silently fix)

- `Logo.tsx` redraws the mark in SVG from the brief — replace with the
  actual exported asset.
- Merchant photos are `picsum.photos` placeholders — swap for real uploads
  once Supabase Storage exists (Feature #003/#004).
- No `next/font/google` — this sandbox has no network access to
  `fonts.googleapis.com`, so system font stacks are used. Fine to switch to
  a real Google Font later; just confirm it fetches in your dev/CI
  environment first.

## Tests

`npm test` — 7/7 passing (`filterMerchants`: category filter, text search
across name/cuisine/neighbourhood/menu items, combined filters, empty
result).

## Open question for the Product Owner (one, per the handover doc's own rule)

Which existing repo (if any) should this replace/merge into — the vanilla
HTML/CSS/JS + Supabase build from the earlier round, or is this a clean
new repo? Doesn't block Feature #001, but affects whether Feature #002
(auth) reuses your existing Supabase project/schema or starts fresh.
