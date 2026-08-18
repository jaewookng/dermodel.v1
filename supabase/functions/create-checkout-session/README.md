# `create-checkout-session` edge function

Creates a Stripe-hosted session for the signed-in caller and returns its URL.
One function covers all three Stripe-hosted flows so the client only has to know
one endpoint.

## What it does

```jsonc
// Start / upgrade a subscription
{ "mode": "subscription", "plan": "plus", "interval": "monthly" }

// Buy a one-time credit top-up pack
{ "mode": "payment" }

// Manage an existing subscription (payment method, cancel, invoices)
{ "mode": "portal" }

// Response, for all three
{ "url": "https://checkout.stripe.com/c/pay/..." }
```

The client redirects the browser to `url`. Optional `return_url` sets where
Stripe sends the user afterwards; it must be on `APP_ORIGIN` (anything else is
ignored and replaced with `/settings`), so the parameter can't be used as an
open redirect.

- `mode` defaults to `"subscription"`, `plan` to `"plus"`, `interval` to
  `"monthly"`.
- Stripe price ids are read from **`billing_plans`**
  (`stripe_price_id_monthly` / `stripe_price_id_yearly`), not hardcoded — a
  price change is an `UPDATE`, not a redeploy.
- Promotion codes are enabled on subscription checkouts.

## Auth

**Required.** The function reads `Authorization: Bearer <supabase access
token>`, verifies it against `/auth/v1/user`, and derives the user id from the
verified token. Nothing in the request body identifies the user, so a caller
can't create or manage someone else's subscription. Anonymous calls (or a bare
anon key) get a `401`.

## Stripe customer mapping

On first use the function creates a Stripe customer with
`metadata.user_id = <supabase user id>` and stores the mapping in
`billing_customers`. The create call uses an idempotency key derived from the
user id, so a double-submit cannot produce two customers for one account.

Subscription checkouts also stamp `subscription_data.metadata.user_id` and
`plan`, which is what `stripe-webhook` reads to attribute the subscription.

## Secrets / env

| Name | Required | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | yes | Stripe API key (`sk_live_…` / `sk_test_…`) |
| `APP_ORIGIN` | no | Allowed return origin; defaults to `https://dermodel.app` |
| `STRIPE_TOPUP_PRICE_ID` | no | Price for the 100-credit pack; `mode: "payment"` is rejected without it |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | auto | Injected by Supabase. Service role is needed to write `billing_customers`, which has no INSERT policy. |

All read from `Deno.env` — never hardcoded.

## Deploy (not done yet — this repo's convention is: write the function, the human deploys)

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set APP_ORIGIN=https://dermodel.app
supabase secrets set STRIPE_TOPUP_PRICE_ID=price_...   # optional
supabase functions deploy create-checkout-session
```

Requires `supabase/migrations/20260818_billing.sql` to be applied first
(`billing_plans`, `billing_customers`), and the Stripe prices to exist with
their ids written into `billing_plans`.
