# Dermodel — Payment & Monetization Design

**Status**: 📐 Design proposal. Schema + edge functions are written
(`supabase/migrations/20260818_billing.sql`,
`supabase/functions/create-checkout-session/`,
`supabase/functions/stripe-webhook/`). **Nothing is deployed**, and no `src/`
code has been changed — the frontend work is specified in
[§7 Frontend changes required](#7-frontend-changes-required) for whoever owns
`src/` next.

---

## 1. Recommendation

**Freemium with a metered AI allowance. The database stays free forever; the
only thing that is ever paywalled is the AI assistant, metered in credits.
One paid tier, "Plus", at $5/month or $45/year, sold through Stripe Checkout.**

The reasoning, in order of weight:

**The database is the moat, not the product to sell.** Dermodel's value is ~50k
products and ~21k canonicalized ingredients that people find via search, the 3D
face model, the ingredient graph, and shared favorites lists. Every one of those
is a discovery surface: `/u/<username>` share links, deep links into product
cards, SEO-able ingredient pages. Paywalling any of it kills the acquisition
loop that makes the paid tier sellable in the first place. Serving a product row
costs a fraction of a cent against an indexed Postgres read — there is nothing
here worth metering.

**The AI chat has real, variable, per-message cost.** Bella
(`supabase/functions/chat`) runs a tool-use loop against the Anthropic API —
typically 2–3 model calls per user message. That is the one place where a heavy
user costs meaningfully more than a light one, so it is the one place where
metering is honest rather than artificial. It's also the natural upsell: the
free allowance is enough to understand why the feature is good and not enough to
live on.

**Credits, not raw messages, as the unit.** Different models cost ~3× different
amounts per turn. Quoting users "300 messages" and then silently making a Sonnet
turn cost 3× as much either loses money or forces a second confusing counter.
One credit = one standard (Haiku) turn; a "deep dive" (Sonnet) turn = 5 credits.
Users see one number; we get a lever that already prices the model difference in.

**Why one paid tier.** Two paid tiers on a solo-maintained consumer app means
two support surfaces, two upgrade paths, two sets of copy, and a decision the
user has to make before paying. A single "Plus" plus a one-off top-up pack
covers the same ground with a fraction of the complexity. Add a second tier when
there's a distinct segment asking for something specific (a Pro/API tier is the
obvious future one — see §9).

### Options considered and rejected

| Option | Why not |
| --- | --- |
| Paywall the database (search limits, "unlock full ingredient list") | Kills SEO, share links, and word-of-mouth. The costs don't justify it and it makes the product worse for the 95% who will never pay. |
| Pure usage-based / pay-as-you-go credits, no subscription | No recurring revenue, worse retention, and it makes every message feel expensive — exactly wrong for an exploratory chat assistant. Kept only as a top-up. |
| Ads | Terrible fit for a health/cosmetics context (the ad inventory is literally competing skincare brands, which destroys the "neutral database" positioning). |
| One-time lifetime purchase | Cost is recurring and per-message; a lifetime price against an unbounded API bill is unbounded downside. |
| Bring-your-own Anthropic key | Solves cost, but the audience is skincare consumers, not developers. Worth offering *alongside* Plus later if power users ask. |
| Donations / "buy me a coffee" | Doesn't scale with the cost driver. Fine as a supplement, not a model. |

---

## 2. Tiers

| | **Signed out** | **Free** (account) | **Plus** — $5/mo or $45/yr |
| --- | --- | --- | --- |
| Browse / search all ~50k products | ✅ | ✅ | ✅ |
| Browse / search all ~21k ingredients | ✅ | ✅ | ✅ |
| Ingredient graph, 3D face model | ✅ | ✅ | ✅ |
| Product images + attribution | ✅ | ✅ | ✅ |
| Favorites | — | ✅ unlimited | ✅ unlimited |
| Shareable favorites (`/u/<username>`) | view only | ✅ | ✅ |
| Submit missing products | ✅ | ✅ | ✅ |
| **AI chat (Bella)** | **6 credits/mo, max 3/day** | **30 credits/mo, max 5/day** | **300 credits/mo, no daily cap** |
| Deep dive (Sonnet-backed answers) | — | — | ✅ (5 credits each) |
| Credit top-up pack | — | ✅ 100 credits for $4 | ✅ 100 credits for $4 |

Credit weights: **1 credit** = one standard chat turn (Claude Haiku 4.5).
**5 credits** = one deep-dive turn (Claude Sonnet 5).

Allowances live in the `billing_plans` table, not in code — retuning a limit is
an `UPDATE`, not a redeploy. The yearly price is 9 months for 12 (a 25%
discount), which is the standard consumer anchor and improves cash flow and
churn at the same time.

**Everything above the chat row is deliberately identical across all three
columns.** That is the design, not an oversight: the free tier has to stay a
genuinely complete product, because it *is* the marketing.

### What the free tier buys us

30 credits/month is roughly a question a day. That is enough to become a habit
and enough to hit the wall during a real research session ("what's actually in
my routine?"), which is exactly the moment to show the upgrade prompt. The 5/day
sub-cap exists so a single curious afternoon can't burn the whole month in ten
minutes and leave the user with three weeks of a dead feature.

The signed-out allowance (6/month, 3/day) exists to let someone try Bella
without an account — the conversion step is "sign in for 30/month", which is
free, and the paid step comes later.

---

## 3. Unit economics

### Cost per chat turn

Model pricing (Anthropic list, per million tokens):

| Model | Input | Output |
| --- | --- | --- |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1.00 | $5.00 |
| Claude Sonnet 5 (`claude-sonnet-5`) | $3.00 | $15.00 |

A turn in the current `chat` function is a tool-use loop, so one user message is
2–3 API calls and the conversation is re-sent each time:

- fixed prefix (system prompt + 4 tool schemas): **~1,150 tokens per call**
- conversation history: **~600 tokens** average
- tool results: 300 tok (ingredient search) → 1,200 tok (a full product
  ingredient list) → 500 tok (products-containing list)

Typical turn — 2 calls, one tool result:

| | Input tok | Output tok | Haiku | Sonnet |
| --- | --- | --- | --- | --- |
| Call 1 (emits `tool_use`) | 1,750 | 120 | | |
| Call 2 (final answer) | 3,070 | 250 | | |
| **Total** | **4,820** | **370** | **$0.0067** | **$0.020** |

Heavy turn — 3 calls, two large tool results (~14,000 in / 600 out):
**$0.017 (Haiku)** / **$0.051 (Sonnet)**.

Planning numbers: **$0.010 average, $0.020 p95** per Haiku credit;
**~3× that** per Sonnet turn. The 5-credit weight on deep dive prices the 3×
plus a buffer for the longer prompts a deep dive tends to attract.

### Per-plan economics

Stripe takes 2.9% + $0.30 per charge.

| | Monthly $5 | Yearly $45 |
| --- | --- | --- |
| Gross | $5.00 | $45.00 |
| Stripe fee | $0.45 | $1.61 |
| **Net** | **$4.55/mo** | **$43.39/yr = $3.62/mo** |
| Expected COGS (40 credits/mo actual usage) | $0.40 | $0.40 |
| **Expected gross margin** | **~91%** | **~89%** |
| Worst case (300 credits, all at p95) | $6.00 | $6.00 |

The cap is a **tail bound, not a margin plan**. Expected usage in a consumer
chat product runs far below the cap — the cap's job is to make sure a single
enthusiastic (or automated) user can't produce an unbounded bill. Even the
absolute worst case is one user costing ~$1.45 more than they pay, which is a
survivable outlier at any realistic subscriber count. If real usage data shows
the p90 subscriber near the cap, the response is to lower `monthly_credits` in
`billing_plans` (an UPDATE) or raise the price — not to add complexity.

Top-up pack: 100 credits for $4 → net $3.58, expected COGS $1.00, worst case
$2.00. It's a relief valve for the occasional heavy month, priced above cost but
not aggressively.

Break-even on the Anthropic bill alone is roughly **1 Plus subscriber per 450
free-tier chat turns**. Fixed costs (Supabase, Firebase Hosting, domain) are on
the order of $25–50/month, so ~12 Plus subscribers covers infrastructure.

### Cost guardrails worth building regardless of tier

1. **Trim conversation history.** `ChatPanel` currently sends the entire
   conversation on every turn, so a long session's per-turn cost grows
   quadratically. Cap it at the last ~8 turns server-side.
2. **Cap tool result size.** `get_product` on a 60-ingredient product returns
   the full list; truncate to the first ~40 with a note. `clampLimit` already
   bounds row counts — this bounds row *width*.
3. **Don't bother with prompt caching.** The fixed prefix is ~1,150 tokens and
   Haiku 4.5's minimum cacheable prefix is 4,096 tokens, so a `cache_control`
   breakpoint would silently never write. Revisit only if the system prompt and
   tool set grow past 4k tokens.
4. **Bound the loop.** `MAX_TOOL_ITERATIONS = 5` already caps the worst case at
   ~6 API calls per credit; keep it.

### ⚠️ Pricing note with an expiry date

Claude Sonnet 5 has introductory pricing of **$2/$10 per MTok through
2026-08-31**, after which it goes to the $3/$15 used above. All numbers here
assume list price, so the deep-dive economics do **not** get worse when the
intro period ends — but any measurement taken before 2026-08-31 will look ~33%
cheaper than steady state. Don't calibrate the credit weight on intro-period
data.

---

## 4. How metering works

### The credit ledger

`chat_usage_events` is an append-only ledger — one row per turn that was
*allowed to run*, carrying credits, model, and (backfilled) token counts and
estimated cost. There is no "balance" column to drift out of sync: remaining
allowance is always `plan_credits + bonus_grants − SUM(credits this month)`,
computed from indexed reads on `(user_id, created_at DESC)`.

Recording actual tokens next to the credits charged is what makes it possible to
check the model in §3 against reality:

```sql
SELECT model,
       COUNT(*) AS turns,
       AVG(est_cost_usd) AS avg_cost,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY est_cost_usd) AS p95
FROM chat_usage_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY model;
```

### The gate

`consume_chat_credits(p_user_id, p_anon_key_hash, p_credits, p_model,
p_deep_dive)` is a `SECURITY DEFINER` function that, in one call:

1. resolves the caller's plan (`billing_plan_for_user` — any subscription in
   `trialing` / `active` / `past_due` counts; otherwise `free`),
2. rejects a deep dive if the plan doesn't allow it,
3. checks month-to-date and day-to-date usage against the plan's allowance
   (plus any unexpired `chat_credit_grants`),
4. writes the debit and returns `(allowed, plan, credits_remaining, reason,
   usage_event_id)`.

It is called **before** the Anthropic request, with the service-role key, and
`p_user_id` comes from the verified JWT — never from the request body. Charging
up front means a crashed or timed-out generation still costs a credit, which is
the correct direction to fail: the API call was made and billed to us either
way.

`record_chat_usage_tokens(usage_event_id, …)` backfills tokens and cost after
the loop finishes. If it fails, the debit still stands; only the analytics
degrade.

### Signed-out metering

Anonymous callers are keyed by `anon_key_hash` — SHA-256 of a client-generated
device id (localStorage) plus a server-side salt, or of `x-forwarded-for` plus
the salt. **This is a speed bump, not a security control**: clearing
localStorage resets it. That's acceptable precisely because the anonymous
allowance is 6 credits (≈ $0.06 to defeat, per identity, per month). The real
backstop is that the allowance is too small to be worth farming.

If anonymous abuse ever shows up in the ledger, the fix is to drop the
signed-out tier entirely (set `billing_plans.monthly_credits = 0` for `anon`) —
no code change required.

### What happens at the limit

`consume_chat_credits` returns `allowed: false` and a `reason`. The chat
function should return HTTP **402 Payment Required** with a machine-readable
body, and the UI turns it into an in-conversation message rather than an error
toast — a wall you hit mid-conversation should feel like Bella talking, not like
a crash:

| `reason` | Signed out | Free | Plus |
| --- | --- | --- | --- |
| `daily_limit` | "That's my limit for today — sign in for more." → sign-in dialog | "You've used today's 5 messages. More tomorrow, or go unlimited-ish with Plus." | n/a (no daily cap) |
| `monthly_limit` | "Sign in to keep chatting — free accounts get 30 a month." | "You've used all 30 this month. Plus gets you 300." → Checkout | "You've used all 300 this month. Grab 100 more for $4." → top-up Checkout |
| `deep_dive_requires_plus` | / | "Deep dives are a Plus feature." → Checkout | n/a |

Three rules for the copy: never lose the user's typed message, always show the
remaining count *before* they hit zero (a counter in the chat header once
they're below ~20%), and never show a hard modal — the rest of the app must stay
usable.

---

## 5. Payment provider: Stripe

Recommended, with **Stripe Tax enabled**.

- Deno edge functions can call the REST API directly with `fetch` — no npm
  dependency, matching the existing `notify-product-submission` and `chat`
  functions' style.
- Checkout and the Billing Portal are both Stripe-hosted, so **no card data
  ever touches our infrastructure or our edge functions** — which also keeps us
  clear of the "never handle payment credentials" rule this project already
  follows for scripts and secrets.
- Subscription lifecycle (dunning, retries, proration, cancellation, invoices)
  is Stripe's problem, delivered as webhooks.
- No lock-in worth worrying about at this size; the mirrored schema is small.

**The one reason to reconsider**: Stripe is not a merchant of record. If a
meaningful share of subscribers are EU/UK consumers, *someone* must handle VAT
registration and remittance. Stripe Tax calculates and files in supported
jurisdictions but the legal liability stays with you; **Paddle** or **Lemon
Squeezy** take that on entirely as merchant of record, at roughly 5% + 50¢
instead of 2.9% + 30¢. At $5/month that's ~$0.15 more per subscriber to make VAT
someone else's problem. → **Decision for the human, see §10.**

### Flow

```
Settings "Upgrade" ──POST──▶ create-checkout-session (JWT verified)
                                  │  get-or-create Stripe customer
                                  │  price id ← billing_plans
                                  ▼
                            Stripe Checkout (hosted)
                                  │
                    user pays ────┤
                                  ▼
Stripe ──webhook──▶ stripe-webhook (HMAC verified, --no-verify-jwt)
                          │  claim event id (idempotency)
                          ▼
                  billing_subscriptions / chat_credit_grants
                          │
                          ▼
              billing_plan_for_user() ──▶ consume_chat_credits()
                                                  │
                                                  ▼
                                          chat edge function
```

`create-checkout-session` also serves the Billing Portal (`mode: "portal"`) and
the top-up purchase (`mode: "payment"`), so the client has one billing endpoint
to know about.

---

## 6. Enforcement points

Everything below is where enforcement *would* live. Only the migration and the
two new edge functions exist today.

### 6.1 `supabase/functions/chat/index.ts` — the hard gate ⚠️ **required**

This is the only place that can actually be trusted, because it is the only
place that holds the Anthropic key. **The chat function as currently written has
no limit of any kind — it must not be deployed publicly before this lands.**

Insert into the existing `Deno.serve` handler, between resolving `userToken`
(line ~367) and the tool-use loop (line ~372):

```ts
// After: const userToken = bearer && bearer !== SUPABASE_ANON_KEY ? bearer : null;

const deepDive = body?.deep_dive === true;
const model = deepDive ? "claude-sonnet-5" : "claude-haiku-4-5";
const credits = deepDive ? 5 : 1;

// Resolve the user id from the VERIFIED token, never from the body.
const userId = userToken ? await resolveUserId(userToken) : null;
const anonHash = userId ? null : await hashAnon(body?.device_id, req);

const gate = await callRpc("consume_chat_credits", {
  p_user_id: userId,
  p_anon_key_hash: anonHash,
  p_credits: credits,
  p_model: model,
  p_deep_dive: deepDive,
});

if (!gate.allowed) {
  return json({
    error: "limit_reached",
    reason: gate.reason,          // monthly_limit | daily_limit | deep_dive_requires_plus
    plan: gate.plan,
    credits_remaining: gate.credits_remaining,
  }, 402);
}
```

Then, after the loop, accumulate `usage.input_tokens` / `usage.output_tokens`
from every `callClaude` response (they are currently discarded) and call
`record_chat_usage_tokens(gate.usage_event_id, …)`, and include
`credits_remaining` in the `{ reply }` response so the UI can render the
counter without a second round trip.

Other required edits in the same file:
- `MODEL` becomes a per-request choice rather than a module constant.
- `callClaude` must return `usage` alongside `content` (or the caller must read
  it off the raw response).
- Trim `messages` to the last ~8 turns before the loop (§3 guardrail 1).
- Truncate the `ingredients` array in `get_product` (§3 guardrail 2).
- New secrets: `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) and `CHAT_ANON_SALT`.

### 6.2 `src/components/Bella/BellaChat.tsx` — limit UX

*(This file was `Chat/ChatPanel.tsx` when this document was written; the chat UI
session renamed it mid-flight. The send path — `supabase.functions.invoke('chat',
{ body: { messages: … } })` — is unchanged.)*

The send handler currently collapses every failure into a single generic error
string. It needs to branch on the 402 body and render the §4 copy inline as a
Bella message rather than a toast. It should also send `device_id` (a
localStorage UUID) and `deep_dive` in the request body, and display the
remaining-credit counter returned alongside `reply`.

### 6.3 `src/pages/Settings.tsx` — the billing surface

A Billing card showing plan, credits used/remaining, renewal date, and:
"Upgrade to Plus" → `create-checkout-session` `{ mode: "subscription" }`;
"Manage billing" → `{ mode: "portal" }`; "Buy 100 credits" →
`{ mode: "payment" }`. Also handle the `?billing=success|cancelled|topup-success`
query params Stripe returns to.

⚠️ `handleDeleteAccount` is currently a `TODO` stub. Whenever it is implemented
it **must cancel any active Stripe subscription first**, or a deleted account
keeps getting charged.

### 6.4 Gates that are UX only, not security

These make the product legible; they are not enforcement, because a user can
bypass any client check by calling the function directly. The §6.1 gate is what
actually holds.

- **Deep-dive toggle** in the chat input — hidden/disabled for non-Plus users.
- **Credit counter** in the chat panel header.
- **Upgrade prompts** at the wall.

### 6.5 Not gated, deliberately

`OptimizedIngredientDatabase.tsx`, `ProductTable.tsx`, `IngredientTable.tsx`,
`GraphPanel.tsx`, `FaceModel.tsx`, `useProducts`, `useIngredients`,
`useProductFavorites`, `SharedFavorites.tsx`, `ProductSubmissionHelp.tsx` — all
stay free for everyone, at every tier. If a future change starts gating one of
these, that is a reversal of this document's central decision and should be
argued explicitly.

---

## 7. Frontend changes required

Not made here (another session owns `src/`). Precise list:

| File | Change |
| --- | --- |
| `src/integrations/supabase/types.ts` | Add `billing_plans`, `billing_customers`, `billing_subscriptions`, `chat_credit_grants`, `chat_usage_events`, `billing_events` under `Tables`; `my_chat_entitlement` under `Views`. `consume_chat_credits` / `record_chat_usage_tokens` are service-role only — no client types needed. |
| `src/hooks/useEntitlement.ts` *(new)* | React Query hook over `my_chat_entitlement` (single row, filtered by `auth.uid()` in the view). `enabled: !!session`. Returns plan, credits remaining, daily used, `allow_deep_dive`, renewal date. |
| `src/hooks/useBilling.ts` *(new)* | Wraps `supabase.functions.invoke('create-checkout-session', …)` for the three modes and does `window.location.href = url`. |
| `src/components/Bella/BellaChat.tsx` | Handle the 402 body; send `device_id` + `deep_dive`; render credit counter and upgrade CTA. |
| `src/pages/Settings.tsx` | Billing card (§6.3) + `?billing=` query-param handling. |
| `src/pages/Pricing.tsx` *(new, optional)* | Public pricing page reading `billing_plans` (granted to `anon`), route `/pricing`. |
| `src/contexts/AuthContext.tsx` | **No change.** Entitlement is deliberately its own hook — it changes on a different cadence than the profile and shouldn't force an auth-context re-render. |
| `firebase.json` | **No change.** The SPA rewrite from 2026-07-18 already covers `/pricing`. |

---

## 8. Deployment checklist

Write-then-human-deploys, as always. Nothing below has been run.

```bash
# 1. Schema
supabase db push                       # includes 20260818_billing.sql

# 2. Stripe dashboard
#    - Product "Dermodel Plus" with two recurring prices: $5/mo, $45/yr
#    - Product "100 chat credits", one-time $4
#    - Enable Stripe Tax
#    - Configure the Billing Portal (allow cancel, update payment method)

# 3. Write the price ids into the plan catalog
#    UPDATE billing_plans
#      SET stripe_price_id_monthly = 'price_...',
#          stripe_price_id_yearly  = 'price_...'
#      WHERE plan = 'plus';

# 4. Secrets
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_TOPUP_PRICE_ID=price_...
supabase secrets set APP_ORIGIN=https://dermodel.app
supabase secrets set CHAT_ANON_SALT=$(openssl rand -hex 32)

# 5. Functions
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt   # ← required
supabase functions deploy chat                             # only AFTER §6.1

# 6. Stripe webhook endpoint
#    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
#    Events: checkout.session.completed,
#            customer.subscription.created/updated/deleted,
#            invoice.payment_failed
```

Verify in test mode before going live: subscribe → `billing_subscriptions` row
appears with `status = active` → `my_chat_entitlement` reports `plan = plus`,
300 credits → chat past 30 credits succeeds → cancel via portal →
`cancel_at_period_end = true` → after the period, `status = canceled` and
entitlement falls back to `free`.

⚠️ **The service-role key rotation from the 2026-07-06 security pass is still
listed as pending in `.claude/CLAUDE.md`.** Both new functions depend on the
service-role key. Rotate first, then deploy — deploying against a
known-compromised key would put billing writes behind it.

---

## 9. Future extensions (not now)

- **Pro / API tier** — programmatic access to the ingredient dataset, per-seat
  or metered. The obvious second tier, but only once someone asks.
- **Team/brand accounts** — formulators comparing competitor products. Different
  buyer, different price point (10–50×), needs sales rather than Checkout.
- **BYO Anthropic key** — unlimited chat, zero COGS, for the handful of users
  who'd want it. `billing_plans` already supports it as a plan row with a huge
  `monthly_credits`.
- **Annual credit rollover** for Plus. Deliberately excluded at launch: it makes
  the tail unbounded again, which is the exact thing the cap exists to prevent.

---

## 10. Open decisions for the human

1. **Stripe vs. a merchant of record.** Stripe is assumed here. If EU/UK
   consumers will be a meaningful share of subscribers, Paddle or Lemon Squeezy
   take VAT liability off you for ~2% more. This is a business/legal call, not a
   technical one. *(Switching later means rewriting both edge functions, not the
   schema — the mirror tables are provider-agnostic apart from column names.)*
2. **$5/mo — right number?** $5 is the consumer-app anchor and makes the
   worst-case-user math tight but survivable. $7 would give real headroom on the
   tail; $3 would make a capped user unprofitable. Recommend $5, revisit after
   3 months of real `chat_usage_events` data.
3. **Keep the signed-out chat allowance at all?** 6 credits/month for anonymous
   users is a nice try-before-signup, and it's trivially farmable. Zeroing it
   (one `UPDATE`) is a legitimate choice — it costs some top-of-funnel and buys
   simpler abuse math.
4. **Charge-before vs. charge-after.** The design charges the credit up front, so
   a failed generation still costs the user. The alternative (refund on failure)
   is friendlier but adds a compensating write and a partial-failure case.
   Recommend charging up front and refunding manually via `chat_credit_grants`
   on support requests.
5. **Grandfathering.** Existing users have been using an unmetered chat. Worth
   deciding whether to seed them a one-time `chat_credit_grants` row (e.g. 100
   credits, `source = 'promo'`) so the limit doesn't feel like a takeaway.
6. **Free-tier size.** 30/month is a guess with no usage data behind it. The
   ledger will answer it properly within a month of launch; the number is a
   single `UPDATE` away either direction.
7. **Account deletion + subscriptions.** `Settings.handleDeleteAccount` is a
   stub. Whoever implements it needs to cancel the Stripe subscription first —
   flagging it so it isn't discovered via a support email.
