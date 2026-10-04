# Kopi Boy Customer Ferrari UX V2

This is a customer-facing presentation/UX redesign only.

## Preserved

- Existing Supabase client/server modules
- Authentication and OAuth/OTP flow
- Existing cart context and localStorage cart
- Existing order placement action
- Existing order status / realtime / rider / chat / support / rating logic
- Existing kitchen and menu queries
- Existing notifications logic
- Existing routes and URLs
- Existing customer database/business rules
- Existing exact Kopi Boy logo assets

Admin and Partner applications are not included or changed.

## Ferrari bodywork implemented

### Home
- Stronger Kopi Boy hero and brand hierarchy
- Larger discovery/search area
- Category browsing cards
- Cuisine chips
- Premium merchant cards
- Floating cart summary when cart contains items
- Refined mobile bottom navigation

### Kitchen / Menu
- Large food hero image
- Kitchen identity and rating summary
- Delivery / direct-pay / $0 platform fee benefit strip
- Menu / Reviews / About visual tabs
- Premium menu rows with large food thumbnails
- Add / quantity controls
- Full food-detail bottom sheet
- Persistent cart access

### Cart / Place order
- Checkout-style hierarchy
- Cleaner order line items
- Quantity controls and remove actions
- Delivery location section using the existing location logic
- Existing delivery-fee estimate retained
- $0 platform-fee message
- Strong primary Place Order CTA
- Existing placeOrder action retained
- Existing redirect to /orders/[id] retained

### Orders
- Refined order-history cards
- Clearer status presentation
- Existing order data and status state machine retained

### Order details
- Premium card shell
- Existing live progress component retained
- Existing rider card, chat, proof-of-delivery, rating, payment and cancellation logic retained

### Profile / Notifications / Sign in
- Consistent customer UX shell
- Profile action list
- Notification inbox cards
- Redesigned Google + phone sign-in screen

## Validation

A TypeScript/TSX transpile syntax check passes for the modified source files.

A full `next build` was not run successfully in this offline build environment because the local dependency install could not complete; Vercel remains the authoritative build environment for this project.
