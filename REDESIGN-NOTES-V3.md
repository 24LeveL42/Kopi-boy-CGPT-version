# Kopi Boy Ferrari UX V3

This version is a customer-facing presentation/UX redesign based on the supplied 10-screen Kopi Boy mockup.

## Visual targets
- Welcome / Get Started
- Home
- All Cooks & Stalls
- Cook / Stall + Menu
- Cart
- Checkout / Place Order
- Order Tracking
- Favourites
- My Account
- Side Menu

## Engine protection
The redesign intentionally keeps the existing Supabase, authentication, cart context, order creation action, order status mapping, rider/tracking, chat, notifications and proof/rating components. Admin and Partner applications are not included or modified.

## Frontend-only additions
- Favourites are stored locally in the customer browser under `kb-favourites`.
- Cart remains the existing local cart and existing `placeOrder()` action is still used.
- Checkout is a presentation step before the same existing order action is called.

## Important
Deploy this only to the separate `Kopi-boy-CGPT-version` test project first. Do not connect this package to `kopi-boy.com` until the customer flow has been tested end-to-end.
