# Customer push notifications (order updates)

Customers get a Web Push notification when their order changes, even with the
app closed. Tapping it opens `/orders/<id>`. This is on top of the existing
in-app bell, toasts and inbox (`docs/notifications.md`), which are unchanged.

## What sends a push

Decided by database triggers (`docs/supabase-customer-push.sql`), worded by
`src/lib/order-push.ts`. Nothing else sends one.

| Change (real columns) | Push |
|---|---|
| `orders.order_status` → `accepted` | Your order was accepted. Pay now and send your proof within 15 minutes. |
| `orders.order_status` → `rejected` or `cancelled` | Your order was cancelled. |
| `orders.payment_status` → `paid` | Payment received. Your food is being prepared. |
| `orders.payment_proof_rejected_at` set to a new time (still accepted + unpaid) | Your payment wasn't received. Please check and send your proof again. |
| `delivery_requests.status` → `accepted` | A rider is on the way to pick up your order. |
| `delivery_requests.status` → `completed` | Your order was delivered. Enjoy! |

There is no "rider picked up" state in the schema; `accepted` means the rider
took the job and is heading to the kitchen, so the wording says that.

The payload is only a short title, that one line, and the order link — no
names, addresses, phone numbers, amounts or PayNow details.

**Never twice for the same change:** each trigger branch only fires when the
value actually changes (`IS DISTINCT FROM`), and the sender claims a once-only
key in `public.customer_push_log` before pushing, so a repeated webhook for
the same change is dropped.

## How it fits with the Partner app

Same Supabase project, same mechanism, separate pieces:

- **Reused:** `pg_net` and the Partner's `private.push_webhook_config` row
  (its shared `secret`). This app adds a `customer_url` column to that row.
- **Not reused: `public.push_subscriptions`.** The Partner's webhook pushes
  every new `public.notifications` row (customer rows included, which contain
  the kitchen name and PayNow number) to every subscription in that table.
  Customer devices in it would get every update twice. Customers have their
  own `public.customer_push_subscriptions` table instead.

## Setup (once) — you do these

### 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**. Don't commit them, don't
paste them anywhere but Vercel (and your own `.env.local` if testing locally).

### 2. Add env variables in Vercel (Customer app project)

Vercel → the Customer app's project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the Public Key from step 1 (used by the browser) |
| `VAPID_PRIVATE_KEY` | the Private Key from step 1 — **secret, server only** |
| `VAPID_SUBJECT` | a contact for the push services, e.g. `mailto:you@yourdomain.com` |
| `PUSH_WEBHOOK_SECRET` | **the same value as `PUSH_WEBHOOK_SECRET` in the Partner app's Vercel project** (it's the shared secret already stored in `private.push_webhook_config`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key — **secret, server only** |

Then **redeploy** (env changes only apply to new deployments).

The Customer app uses its own VAPID key pair; it doesn't need the Partner's.

### 3. Run the SQL

Supabase → SQL Editor → paste all of `docs/supabase-customer-push.sql` → Run.
It's safe to re-run.

### 4. Point the webhook at this app

In the SQL Editor, with your real Customer app domain:

```sql
update private.push_webhook_config
set customer_url = 'https://YOUR-CUSTOMER-DOMAIN/api/push/order-update';
```

The secret is the one already in that row (shared with the Partner app), so
there's nothing else to set. Check it took:

```sql
select customer_url, length(secret) as secret_length from private.push_webhook_config;
```

If that returns **no row**, the Partner app's push uses the dashboard webhook
rather than `docs/supabase-push-trigger.sql`, so the row was never created.
Create it with both URLs and the shared secret instead:

```sql
insert into private.push_webhook_config (id, url, secret, customer_url)
values (
  true,
  'https://YOUR-PARTNER-DOMAIN/api/push/send',
  'THE-SAME-PUSH_WEBHOOK_SECRET-AS-IN-VERCEL',
  'https://YOUR-CUSTOMER-DOMAIN/api/push/order-update'
)
on conflict (id) do update set customer_url = excluded.customer_url;
```

(The `url` column is only used by the Partner's pg_net trigger, which isn't
installed in that case.)

### 5. Check it works

Sign in on a phone, place an order, tap **Turn on notifications** on the order
page, close the app, then accept the order as the cook. Then:

```sql
select id, status_code, left(content, 160) as response
from net._http_response order by created desc limit 5;
```

`200 {"sent":1,...}` = pushed · `{"subscriptions":0}` = the customer hasn't
turned notifications on · `401` = `PUSH_WEBHOOK_SECRET` doesn't match the
secret in the config row · `503` = env vars missing or not redeployed.

## In the app

- **Prompt:** a "Turn on notifications" card on the order page, so it first
  appears right after the customer's first order, never on a first visit.
  "Not now", declining the browser prompt, or switching off in settings means
  it never shows again on that device.
- **iPhone:** Safari only allows push from an app added to the Home Screen.
  In a Safari tab the card instead says *"To get notifications on iPhone, tap
  Share then Add to Home Screen."*
- **Switch:** Profile → Notifications (`/account/notifications`) → "Order
  notifications" on/off. It always says which state it's in: on, off,
  blocked in browser settings (with steps to unblock), iPhone needs Add to
  Home Screen, not on https, browser can't do it (e.g. an in-app browser), or
  not set up. **"Notifications aren't set up for Kopi Boy yet"** means the
  deployed build has no `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: it's read when the app
  is built, so add it in Vercel (step 2) and redeploy.
- **Shared phones:** signing in hands the device's subscription to the new
  account; signing out removes it.
- Code: `public/sw.js` (shows the push, opens the order on tap),
  `src/lib/push-client.ts`, `src/components/PushNotifications.tsx`,
  `src/app/api/push/order-update/route.ts` → `src/lib/order-push-server.ts`.
