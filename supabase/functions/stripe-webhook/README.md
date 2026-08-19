# `stripe-webhook` edge function

Receives Stripe webhooks and mirrors subscription state into Supabase, so an
entitlement check is one indexed read against `billing_subscriptions` rather
than a Stripe API call on every chat message.

## Events handled

| Event | Effect |
| --- | --- |
| `checkout.session.completed` | Ensures the `billing_customers` mapping exists. Subscription checkouts fetch the subscription and upsert it; one-time (`mode: "payment"`) checkouts insert a `chat_credit_grants` row for the top-up pack. |
| `customer.subscription.created` | Upserts `billing_subscriptions`. |
| `customer.subscription.updated` | Upserts status, period bounds, and `cancel_at_period_end` (this is how `past_due` and downgrades arrive). |
| `customer.subscription.deleted` | Upserts with `status = 'canceled'`. |
| `invoice.paid` | Re-reads the subscription and upserts it, so `current_period_end` (the renewal date the Settings billing card shows) stays right across monthly, 6-month, and annual renewals. **No credits are granted here** — see below. |
| `invoice.payment_failed` | Logged only — Stripe flips the subscription to `past_due` and sends a separate `.updated`. The hook exists so dunning email can be added here later. |

Any other event type is acknowledged with `200` and ignored; returning non-2xx
would make Stripe retry events that will never be processed.

## Where the monthly $10 allowance comes from (not here)

The Premium "$10 of Bella usage credits" allowance is **not** granted by this
webhook. It is `billing_plans.monthly_credits` evaluated per **calendar month**
inside `consume_chat_turn()`. Two reasons:

1. **Interval-agnostic.** `invoice.paid` fires once per billing period, so a
   grant-on-invoice design would hand a 6-month prepayer $10 every six months
   and an annual subscriber $10 a year. The calendar-month derivation gives all
   three intervals the same $10/month.
2. **No dropped-webhook failure mode.** There is nothing to drop: a subscriber
   whose webhook never arrived still has correct entitlement the moment
   `billing_subscriptions` says `active`.

`chat_credit_grants` remains for top-up purchases, promos, and support goodwill.
It has a `stripe_invoice_id` column (unique, added in
`20260821_billing_pricing_v2.sql`) so an operator can make a one-off grant
against a specific invoice exactly once.

## Security

- **Signature verification is the authentication.** The function reads the raw
  request body (never a re-serialized copy — the HMAC is over the exact bytes),
  parses `Stripe-Signature`, recomputes `HMAC-SHA256("<t>.<body>")` with
  `STRIPE_WEBHOOK_SECRET` via Web Crypto, and compares in constant time.
  Deliveries with a timestamp more than 5 minutes old are rejected (replay
  guard).
- **No CORS headers.** This endpoint is server-to-server only and must not be
  callable from a browser page.
- Must be deployed with **`--no-verify-jwt`**: Stripe sends its own signature
  and no Supabase JWT, so the default `verify_jwt` would 401 every delivery.

## Idempotency

Stripe retries deliveries. The function inserts `stripe_event_id` into
`billing_events` **before** doing any work; a duplicate conflicts on the primary
key and returns `{ ok: true, duplicate: true }` without reprocessing. If
processing then throws, the claim row is deleted so Stripe's retry can
reprocess. Credit grants carry a second layer: `chat_credit_grants
.stripe_payment_intent_id` is `UNIQUE` and the insert uses
`resolution=ignore-duplicates`.

⚠️ If the claim-release delete also fails (logged as
`Failed to release event claim`), the event stays claimed and Stripe's retries
will be skipped as duplicates. Recovery: delete the `billing_events` row and
replay the event from the Stripe dashboard.

## Attributing an event to a user

Three fallbacks, in order:

1. `metadata.user_id` — stamped onto the Checkout Session and the subscription
   by `create-checkout-session`.
2. `billing_customers.stripe_customer_id → user_id`.
3. The Stripe customer object's own `metadata.user_id`.

Plan is resolved from the subscription's price id against
`billing_plans.stripe_price_id_monthly` / `_semiannual` / `_yearly`, falling
back to the checkout metadata, then to `premium`. All three intervals map to the
same plan row — the interval changes the price, not the entitlement.

Unattributable events are logged and skipped rather than written against a
guessed user.

## Secrets / env

| Name | Required | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | yes | Reading subscriptions/customers back from Stripe |
| `STRIPE_WEBHOOK_SECRET` | yes | Signature verification (`whsec_…`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | auto | Injected by Supabase. Service role is required — every billing table is read-only or unreachable for anon/authenticated. |

All read from `Deno.env` — never hardcoded.

## Deploy (not done yet — this repo's convention is: write the function, the human deploys)

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase functions deploy stripe-webhook --no-verify-jwt
```

Then in the Stripe dashboard add an endpoint pointing at
`https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, subscribed to
the six events in the table above, and copy its signing secret into
`STRIPE_WEBHOOK_SECRET`.

Local testing:

```bash
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
stripe trigger checkout.session.completed
```

Requires `supabase/migrations/20260818_billing.sql` and
`supabase/migrations/20260821_billing_pricing_v2.sql` to be applied first.
