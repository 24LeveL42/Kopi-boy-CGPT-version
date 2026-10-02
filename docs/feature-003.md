# Feature #003 — Merchant Onboarding (Customer-app half)

## Scope

The Customer app's half of Feature #003: read real, live cook kitchens from
Supabase instead of `demo-data.ts`. The cook-facing setup UI lives in the
Partner app repo (`src/components/KitchenSetupForm.tsx`) — see that repo's
`docs/feature-003.md`.

## What changed

| File | Change |
|---|---|
| `docs/supabase-schema.sql` | Appended the `kitchens` and `menu_items` tables + RLS policies (same migration as Partner/Boss repos — run once per Supabase project, not once per repo). |
| `src/lib/kitchens.ts` | New. `getLiveMerchants()` — server-side query joining `kitchens` (`is_live = true`) with `menu_items`, mapped into the existing `Merchant[]` shape so `<Marketplace>` needs no changes. |
| `src/app/page.tsx` | Now calls `getLiveMerchants()` instead of importing `MERCHANTS` from `demo-data.ts`. |
| `src/app/merchant/[id]/page.tsx` | Was a demo-data lookup by id — now queries the real `kitchens` row by id (the id in the URL is a real kitchen/cook UUID now, not a demo slug). |

## Known placeholders (intentional, not gaps to silently fix)

- `rating` / `ratingCount` are always `0`, with `isNew: true` set instead —
  there's no ratings feature yet (#009). Don't backfill fake ratings.
- `etaMinutes` (30) and `distanceKm` (0) are fixed placeholders — no
  geolocation or delivery-fee-engine feature exists yet (#007). Replace both
  when that lands; don't wire fake per-merchant variance in the meantime.
- `heroImage` / `avatarImage` fall back to the merchant's category photo
  (`/categories/*.jpg`) when a cook hasn't set a kitchen photo — the kitchen
  photo itself is optional per the locked spec ("menu items and price tags
  are mandatory; a food photo is optional").
- `demo-data.ts` is no longer imported by any page — kept only because
  `tests/filter-merchants.test.ts` has its own inline fixtures and doesn't
  touch it either, so it's effectively just a reference/seed-data example
  now. Fine to delete later; not urgent.

## What's still NOT here

- Full menu grid / cart / PayNow checkout on the merchant detail page — #004
  and #005/#006.
- Anything that would let a customer browse or filter by delivery
  availability — no delivery/rider matching exists yet (#007/#008).

## Open question for the Product Owner

None blocking. Note for whoever picks up #004: the merchant detail page
currently re-derives the cuisine label locally (`CUISINE_LABEL` map) instead
of importing a shared constant — worth centralizing once a second file needs
the same map (`src/lib/kitchens.ts` also has one).
