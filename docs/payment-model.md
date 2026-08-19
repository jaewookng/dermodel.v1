# Dermodel — Payment & Monetization Design (v3)

**Status**: 📐 Design. Schema and edge functions are written and **nothing is
deployed**. No `src/` code has been changed — the frontend work is specified in
[§8](#8-frontend-changes-required) for whoever owns `src/`.

| Artifact | State |
| --- | --- |
| `supabase/migrations/20260818_billing.sql` | ✅ **applied in production** — do not edit |
| `supabase/migrations/20260821_billing_pricing_v2.sql` | 📝 written, not applied |
| `supabase/migrations/20260824_billing_regions.sql` | 📝 written, not applied — **v3** |
| `supabase/functions/create-checkout-session/` | 📝 three intervals + **region gate** |
| `supabase/functions/stripe-webhook/` | 📝 three intervals, `invoice.paid`, **region verification** |
| `supabase/functions/chat/` | ⚠️ **still ungated** — see §7.1 |
| `supabase/migrations/20260823_bella_memory.sql` | ⚠️ owned elsewhere — **one change needed**, see §9.6 |

`20260824_billing_regions.sql` was validated by applying `20260818` →
`20260821` → `20260823` → `20260824` inside a single rolled-back transaction on
a local Postgres 17, and again with `20260821` omitted, to confirm it is
order-independent. The lifetime gate, the turn cap, region resolution, the
consent precedence rules and `my_chat_entitlement` were all exercised
functionally in that transaction. Nothing was written to any real database.

---

## 1. What changed from v1, and why

v1 sold **chat volume**. v2 sells **memory**. That single repositioning drives
every other change.

| | v1 (2026-08-18) | v2 (this document) |
| --- | --- | --- |
| **The recurring value** | "300 AI messages a month" | "Bella remembers your cabinet: what you own, when it runs out, and she checks in" |
| **Paid tier** | Plus, $5/mo or $45/yr | **Premium, $8.99/mo**, $48.54/6mo (10% off), $91.68/yr (15% off) |
| **Free chat allowance** | 30 credits/mo, 5/day (credits = turns) | **5 conversations/month**, 12 turns each |
| **Signed-out allowance** | 6 credits/mo | 2 conversations, lifetime (§7.3) |
| **Paid chat allowance** | 300 credits | **"$10 of Bella usage credits"** per month |
| **Credit unit** | 1 credit = 1 Haiku turn | 1 credit = **$0.001 of user-facing credit value** |
| **Free-tier metering** | credits | **conversations** (a new `chat_conversations` object) |
| **Billing intervals** | 2 | **3** |
| **Favorites** | free, unlimited | unchanged — *and now explicitly retained forever* |

### v2 → v3

Three changes and one new subsystem. Nothing about the memory-first
repositioning changes; v3 is about how much margin the markup implies, how long
the free allowance lasts, and where we are willing to sell.

| | v2 | v3 (this document) |
| --- | --- | --- |
| **Markup multiple** | 11.12× | **12×** |
| **Consumer price per message** | $0.10 | **$0.10 — unchanged** |
| **What 12× actually changes** | — | the *real cost budget* behind $0.10 tightens from $0.009 to **$0.008333/turn** |
| **Pre-Stripe margin @ full consumption** | 90.0% | **90.73%** |
| **Free chat allowance** | 5 conversations **per month** | **5 conversations per LIFETIME** |
| **Signed-out allowance** | 5 conversations/month, 12 turns | **2 conversations per lifetime, 8 turns** |
| **Free-tier cost shape** | recurring, grows with user count | **one-off per user; grows with *signups*, not users** |
| **Break-even conversion** | 1.4% sustained | **≈0.13% typical / ≈0.55% worst case** (§6) |
| **Where we sell** | everywhere Stripe reaches | **three region tiers, driven by a data table** (§9) |
| **Check-in email default** | ON for everyone | **ON in `always_on`; OFF until consent in `consent_first`** |
| **Consent record** | none | **append-only `email_consent_events`, with the exact wording shown** |

**Why the repositioning is right.** A chat-volume subscription is a treadmill:
the user asks "did I get $9 of chat this month?", and the answer is usually no,
so they churn. A memory subscription is a ratchet: every product they add makes
cancelling more expensive, and the check-in email is a monthly reminder that the
thing is working *without them doing anything*. Chat volume is a bad recurring
product for exactly the reason memory is a good one.

**Why the credit allowance survived anyway.** "$10 of Bella usage credits for
$8.99" is a legible value anchor that makes the price look like a discount even
before you count the memory features. It costs us at most ~$0.90 to honour
(§3), which is a cheap anchor.

**What v1 got right and is kept unchanged:**

- The database is the moat, not the product to sell. Browsing ~50k products and
  ~21k ingredients, the 3D face, the graph, product images, `/u/<username>`
  share links, product submissions — all free at every tier, forever. Gating any
  of it would kill the acquisition loop. (§7.5)
- Stripe, called over REST from Deno, with Checkout and the Billing Portal
  hosted so no card data touches our infrastructure. (§6)
- The append-only `chat_usage_events` ledger with no balance column, so
  remaining allowance is always derived and can never drift.
- Charge before the Anthropic call, not after.
- The merchant-of-record question is still open. (§9.1)

---

## 2. Tiers

| | **Free** (signed in) | **Premium** |
| --- | --- | --- |
| Price | $0 | **$8.99/mo** · $48.54/6mo · $91.68/yr *(where sold — §9)* |
| Browse/search all products & ingredients | ✅ | ✅ |
| Ingredient graph, 3D face model, images | ✅ | ✅ |
| **Favorites — retained forever** | ✅ | ✅ |
| Shareable favorites (`/u/<username>`) | ✅ | ✅ |
| Submit missing products | ✅ | ✅ |
| **Bella chat** | **5 conversations, ever** — up to 12 turns each | **$10 of usage credits/month** (≈100 messages) |
| Deep dive (Sonnet answers) | — | ✅ ($0.40 each) |
| **Cabinet memory** (what you own) | — | ✅ |
| **Replenishment tracking** (when it runs out) | — | ✅ |
| **Check-in emails** | — | ✅ |
| Surveys | — | ✅ |
| Product referrals | — | ✅ |
| Credit top-up | — | $5 → $5 more of credits |

Interval pricing, exactly:

| Interval | Charge | Effective /mo | Discount |
| --- | --- | --- | --- |
| Monthly | $8.99 | $8.99 | — |
| 6-month prepay | **$48.54** | $8.09 | 10.0% |
| Annual prepay | **$91.68** | $7.64 | 15.0% |

Both prepay numbers are built from the rounded effective monthly price
(6 × $8.09, 12 × $7.64) so the "$8.09/mo, billed every 6 months" copy is exactly
true rather than off by a fraction of a cent.

**Signed out is a separate, smaller tier now: 2 conversations of 8 turns,
also for life.** v2 gave signed-out visitors the same 5 as Free. §7.3 explains
why that stops making sense once the allowance never resets.

**Favorites are retained forever on the free tier, explicitly.** Owner's words:
"they can always come back for it." This is a deliberate anti-hostage stance —
we are not holding a free user's saved products to ransom. What Premium adds is
not *access* to your list but *work done on it*: quantities, run-out dates,
check-ins, referrals. That distinction is the whole product.

**The $10 allowance is flat across all three intervals.** An annual subscriber
paying an effective $7.64/mo gets the same $10 of credits as a monthly
subscriber paying $8.99. This is a small, deliberate margin give (§3) in
exchange for never having to explain three different allowances.

---

## 3. Unit economics: the 12× markup

### The constraint

Owner's constraint, restated for v3: **the markup multiple is 12×.** That is
now the input rather than the output — v2 back-solved 11.12× from a 90% margin
target; v3 fixes the multiple at a round 12 and reads the margin off it.

```
real Anthropic spend behind a fully consumed $10 allowance = $10.00 / 12 = $0.8333
$0.8333 / $8.99 revenue                                    = 9.27% COGS
pre-Stripe gross margin at full consumption                = 90.73%
```

**The new pre-Stripe margin at full consumption is 90.73%** (was 90.0%). The
constraint tightened by 0.73 points — small in margin, but it is the *sign* of
the change that matters: 12× is a slightly harder promise to keep than 11.12×,
not an easier one.

### What actually changed, and what didn't

**The consumer-facing numbers do not move.** A standard message is still
**$0.10**, a deep dive still **$0.40**, and **$10 still buys 100 messages**.
Raising the markup at a fixed price cannot change the price; it changes the
*cost ceiling behind* the price:

```
real cost budget per standard turn = $0.10 / 12 = $0.008333   (was $0.009)
real cost budget per deep dive     = $0.40 / 12 = $0.033333   (was $0.036)
```

This is the right way to spend a markup increase. The alternative — holding the
cost assumption at $0.009 and letting the price float to $0.108 — buys nothing
and destroys the single best property the pricing has, which is that the
arithmetic is trivial in the user's head. $0.108 per message and "92.6 messages
for $10" is a worse product for identical margin.

| | Real cost | User-facing price | Effective markup |
| --- | --- | --- | --- |
| **Standard turn** (Haiku 4.5) | $0.0067 typical / **$0.008333 budget** / $0.017 heavy | **$0.10** | 14.9× / **12.0×** / 5.9× |
| **Deep dive** (Sonnet 5) | $0.020 typical / **$0.033333 budget** / $0.051 heavy | **$0.40** | 20× / **12.0×** / 7.8× |

Read the middle column as a ceiling, not a forecast. The measured typical turn
is $0.0067, comfortably inside $0.008333; a heavy tool-saturated turn is
$0.017, twice over. `billing_config.assumed_turn_cost_usd` is set to
**0.008333** and is both the planning figure for the spend rollup *and* the
number the p95 query below is measured against.

### What $10 buys

```
$10.00 / $0.10 per message = 100 standard messages per month   (unchanged)
```

- **100 standard messages**, or **25 deep dives**, or any mix.
- At ~3.5 turns per conversation, **≈28 conversations a month**.

Credits stay milli-dollar denominated: `monthly_credits = 10000`, a standard
turn 100 credits, a deep dive 400. The $5 top-up remains 5,000 credits, which
at 12× is $0.4167 of real spend — the same margin shape as the subscription.

### Margin table (Stripe fees included)

Stripe: **2.9% + $0.30 per charge**. COGS at the 12× budget: 0% consumption =
$0.00, 50% = $0.4167, 100% = $0.8333.

| | Monthly $8.99 | 6-month $48.54 | Annual $91.68 |
| --- | --- | --- | --- |
| Gross revenue / month | $8.99 | $8.09 | $7.64 |
| Stripe fee (per charge) | $0.5607 | $1.7077 | $2.9587 |
| Fee as % of gross | 6.24% | 3.52% | 3.23% |
| Net revenue / month | $8.4293 | $7.8054 | $7.3934 |
| **Margin @ 0% consumption** | **93.8%** | **96.5%** | **96.8%** |
| **Margin @ 50% ($0.4167)** | **89.1%** | **91.3%** | **91.3%** |
| **Margin @ 100% ($0.8333)** | **84.5%** | **86.2%** | **85.9%** |
| *Pre-Stripe gross margin @ 100%* | ***90.73%*** ✅ | *89.70%* | *89.09%* |

Every post-Stripe cell improves by 0.5–0.8 points against the v2 table, because
the only thing that moved is COGS, downward by $0.067/month at full
consumption. Three readings still hold:

1. **The constraint is met.** Monthly, pre-Stripe, at full consumption: 90.73%,
   which is 12× by construction.
2. **Prepay is cheaper for us than the discount suggests.** The $0.30 fixed fee
   is charged once per invoice, so annual pays it once instead of twelve times.
   That recovers 3.0 points of fee. **The 15% annual discount is roughly
   half-funded by Stripe's own fee structure.** Push prepay.
3. **Raising the price was fee-accretive.** From $5 to $8.99 the monthly fee
   rose in dollars ($0.445 → $0.561) but fell as a *share* of revenue (8.9% →
   6.2%). The $0.30 flat component is what hurts small-ticket subscriptions,
   and price is the main lever against it.

### The tail, and why the ledger matters

The $0.10 face price is charged **per turn regardless of that turn's actual
token cost**. That is right for the user (predictable) and creates a tail risk
for us: a subscriber whose 100 messages are all heavy, tool-saturated turns
costs $1.70, not $0.83 — margin falls to **74.9%** after Stripe (monthly
interval). That is survivable as an outlier and unacceptable as a norm, and it
is 0.7 points *worse* to tolerate under 12× than under 11.12× because the
budget it blows through is smaller.

This is why `chat_usage_events` records real `input_tokens` / `output_tokens` /
`est_cost_usd` next to the credits charged. The check is one query:

```sql
SELECT model,
       COUNT(*)                                                  AS turns,
       AVG(est_cost_usd)                                         AS avg_cost,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY est_cost_usd) AS p95
FROM chat_usage_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY model;
```

If the realized blended turn cost exceeds **$0.008333**, the 12× multiple is
broken and the response is an `UPDATE billing_config SET value = …` on
`standard_turn_credits` (raise the per-turn price) — not a redeploy.
**$0.008333 is the number to watch**; it is the single-sentence version of this
entire section. Deep dives should be watched separately against $0.033333: a
heavy Sonnet turn at $0.051 is 1.5× over its budget, which makes deep dives the
thinner-margin half of the product.

### Cost guardrails that must ship with the gate

Carried over from v1, all still required:

1. **Trim conversation history server-side to the last ~8 turns.** Without this
   a long conversation's per-turn cost grows quadratically — and v2's 12-turn
   free conversations make that worse, not better.
2. **Cap tool-result size.** `get_product` on a 60-ingredient product returns
   the whole list; truncate to ~40 with a note. `clampLimit` bounds row *count*;
   this bounds row *width*.
3. **Don't add prompt caching yet.** The fixed prefix is ~1,150 tokens and Haiku
   4.5's minimum cacheable prefix is 4,096, so a `cache_control` breakpoint
   would silently never write. Revisit if the system prompt + tool schemas grow
   past 4k.
4. **Keep `MAX_TOOL_ITERATIONS = 5`.**

### ⚠️ Pricing note with an expiry date

Claude Sonnet 5 has introductory pricing of $2/$10 per MTok **through
2026-08-31**, after which it is $3/$15. Every number here assumes list price, so
deep-dive economics do not get worse when the intro period ends — but any
measurement taken before that date will look ~33% cheap. Do not calibrate
`deep_dive_turn_credits` on intro-period data.

---

## 4. Modelling a "conversation"

This was the real design problem in v2 and it survives v3 unchanged in
substance: the applied schema meters **credits per turn**; the free tier is
denominated in **conversations**, where a conversation is "one conversation,
however many turns." What v3 changes is the *period* — the allowance is now
per lifetime, which makes the durability of the counter (§4.4) the new hard
part.

### The three candidates

| Model | How it works | Why not / why |
| --- | --- | --- |
| **A. Turn-grouping window** | No id anywhere. A "conversation" is any run of turns less than N minutes apart, computed at read time. | Zero client changes, but the count is *ambiguous* — the UI can't honestly say "2 of 5 left" because the answer changes as the clock moves, and a user who pauses 31 minutes mid-thought silently loses a conversation with no way to see it coming. Rejected: an allowance the user cannot count is an allowance they will feel cheated by. |
| **B. Client-generated session id** | Client mints a UUID per chat window and sends it every turn. | The obvious abuse (mint a new id per turn) actually *hurts* the abuser — it burns quota faster. The real hole is the opposite: hold one id forever and farm unlimited turns. Also: nothing stops a client claiming someone else's id. |
| **C. Server-minted conversation row** ✅ | First turn arrives with `conversation_id: null`; the gate inserts a `chat_conversations` row and returns its id; the client echoes it on every later turn; the gate re-validates ownership and liveness each time. | Costs one table, one FK on the ledger, and one field on the request/response. Buys an auditable unit that the UI can count honestly, that RLS can scope, and that the gate can bound. |

**Chosen: C.** The tradeoff being accepted is a small amount of plumbing (the
client must round-trip an opaque id it does not otherwise care about) in
exchange for the allowance being a *real object* rather than an inference. Since
the free tier's entire limit is denominated in this unit, the unit has to be
something we can point at, show the user a count of, and defend in a support
email. A/B cannot do that.

### Bounding "keep one conversation open forever"

Three independent bounds, all in `billing_config` so they are tunable by
`UPDATE`:

| Bound | Free value | Signed out | Effect when tripped |
| --- | --- | --- | --- |
| `billing_plans.conversation_turn_cap` | **12 turns** | **8 turns** | **Hard stop.** Gate returns `conversation_turn_limit`. The user must explicitly start a new chat, which consumes another conversation from the allowance. |
| `conversation_idle_minutes` | **30 min** | 30 min | Conversation closed silently; the next turn transparently opens a new one (and consumes allowance). They walked away and came back — that genuinely is a new conversation. |
| `conversation_max_age_hours` | **24 h** | 24 h | Same as idle. Stops one id spanning weeks. |

The turn cap is the load-bearing one, and under a lifetime allowance it becomes
dramatically more load-bearing: 5 conversations × 12 turns = **60 turns for the
entire life of a free account**, ≈$0.40–0.50 of real spend for the most
determined free user alive, *ever*. Idle and age exist so the *count* stays
honest, not so the cost does.

⚠️ **The idle and age bounds are now more expensive to the user than they were.**
Under a monthly allowance, walking away for 31 minutes cost a conversation you
would get back on the 1st. Under a lifetime allowance it costs one of five you
never get back. Two consequences the UI must honour:

- The counter has to be visible *during* a conversation, not just at the wall.
- "Start a new chat" needs a confirmation step for free users, because it is now
  a permanent spend. §7.2 covers the copy.

If that proves too punishing in practice, `conversation_idle_minutes` is one
`UPDATE` away from 120.

The turn cap deliberately does **not** auto-roll into a new conversation.
Silently spending another of the user's five chats because they sent a 13th
message is the kind of thing that generates refund requests. The gate refuses,
the UI says "this chat has run long — start a new one (2 of 5 left this month)",
and the user chooses.

### Where the lifetime counter lives, and how it survives

An allowance that never resets is only as good as the counter behind it. The
counter has to survive four things, and the fourth is the one that dictates the
design:

| Attack / accident | Why it fails to reset the count |
| --- | --- |
| Signing out and back in | The count is server-side. Nothing about it is read from or written to the client. |
| Clearing localStorage / cookies | Same. For a **signed-in** user the client identity is irrelevant — the key is derived from the account. |
| Deleting and re-adding favorites | Entirely unrelated tables. Favorites have never been part of metering. |
| **Deleting the account and signing up again with the same login** | `chat_lifetime_conversations` has **no foreign key to `profiles`**, so the `ON DELETE CASCADE` that clears a user's rows everywhere else does not reach it — and its key is derived from the **login email**, not from the (freshly minted) user id. |

The fourth row is the whole point. Every other billing table in this schema
cascades from `profiles`; this one deliberately does not, and that is not an
oversight to be tidied up later.

**The key.** `chat_identity_key(user_id, anon_key_hash)` returns:

| Prefix | Derived from | Durable? |
| --- | --- | --- |
| `u:<md5>` | salted MD5 of the normalized login email | ✅ survives account deletion |
| `uid:<uuid>` | the user id, when no email is on record | ❌ resettable — should not occur with OAuth-only signup |
| `a:<hash>` | the anonymous device hash | ❌ not durable at all — §7.3 |

The salt is one row in `chat_identity_salt`, generated at migration time and
service-role only. MD5 is used because it is a core builtin and needs no
`pgcrypto` dependency; the threat model is "don't keep a second plaintext copy
of the user list in a counter table", not "resist an attacker who already has
the salt".

**⚠️ The privacy tension, stated plainly.** Surviving account deletion is the
entire purpose of this table and it is in direct tension with an erasure
request. The position taken here is: on a genuine erasure request the operator
**deletes the row and accepts that the person's free allowance resets**. Do not
build an exception that retains it "just in case". The counter is worth less
than the erasure obligation, and the row it keeps is a salted hash and two
timestamps — a small thing to give up.

**The counter increments for Premium too.** A subscriber's conversations are
counted even though nothing gates them, because otherwise a user could
subscribe for one month, chat freely, cancel, and land back on a free tier with
five untouched conversations. `chat_lifetime_conversations` is a record of what
someone has used, not of what they were charged for.

**Operator escape hatch.** `chat_lifetime_conversations.bonus_conversations` is
added to the plan allowance. Support hands out more conversations with one
`UPDATE`, exactly as `chat_credit_grants` does for credits. Without this, "I
lost a chat to a 30-minute timeout" has no answer, and under a lifetime cap
that complaint is legitimate.

**Reverting is an `UPDATE`.** `lifetime_conversations` takes precedence in the
gate; when it is set, the monthly and daily columns are not consulted. Going
back to a monthly allowance is:

```sql
UPDATE billing_plans
   SET lifetime_conversations = NULL, monthly_conversations = 5
 WHERE plan = 'free';
```

and nothing else. Both code paths are live and tested.

### How Premium is metered

Premium keeps **credit** metering, not conversation metering
(`billing_plans.metering_mode = 'credits'`): unlimited conversations, unlimited
turns per conversation, bounded by the $10. Conversations are still recorded for
Premium users so the ledger, the UI, and future Bella memory work all speak one
language — they are just not a gate.

`consume_chat_turn()` therefore has two enforcement paths selected by
`metering_mode`, but **one commit path**: every allowed turn writes a
`chat_usage_events` row with credits *and* a `conversation_id`, whatever the
plan. Cost analytics never have to special-case a tier.

---

## 5. Where the monthly $10 comes from

**Not from a webhook.** The allowance is `billing_plans.monthly_credits`
evaluated against **calendar-month** usage inside `consume_chat_turn()`. Two
reasons, and the first is decisive:

1. **`invoice.paid` fires once per billing period.** A grant-on-invoice design
   would give the annual subscriber $10 *per year*. Getting that right would
   mean a scheduled job that fans out monthly grants to every prepaid
   subscriber — a cron, a new failure mode, and a backfill story. Deriving from
   the calendar month gives all three intervals $10/month with no moving parts.
2. **No dropped-webhook failure mode.** There is nothing to drop. The moment
   `billing_subscriptions.status` says `active`, entitlement is correct.

The webhook does now handle `invoice.paid`, but only to re-read the subscription
so `current_period_end` (the renewal date on the Settings card) stays accurate
across 6-month and annual renewals.

**Accepted rough edge — no proration on mid-month upgrade.** Someone who
subscribes on the 28th gets a full $10 for three days. Worst case that costs
$0.90 of real spend against a $8.99 charge, so it is still profitable; it is not
worth a proration path. Flagged because it *will* be discovered.

**No rollover.** Unused credits expire at month end. Rollover makes the cost
tail unbounded again, which is the one thing the allowance exists to prevent.
`chat_credit_grants` remains the escape hatch for goodwill (and now carries a
unique `stripe_invoice_id` so an operator grant against a specific invoice is
idempotent).

---

## 6. Free-tier burn under a lifetime cap

This is where the v3 change pays for itself, and the size of the effect is the
main argument for making it.

### 6.1 The structural change

Under a monthly allowance, a free user is a **recurring** cost: they cost
$0.12–0.16 in January and the same again every month they stay, forever. Under
a lifetime allowance a free user is a **one-off acquisition cost** that is fully
paid within their first few sessions and is $0.00 thereafter.

**Free-tier burn is now proportional to signups per month, not to user count.**
That single sentence is the whole change. A product with 100,000 free users and
no new signups has a free-tier API bill of zero.

### 6.2 Per-user cost, once and forever

| | Turns | @ $0.0067 measured | @ $0.008333 budget |
| --- | --- | --- | --- |
| **Typical engaged free user** (5 conversations × ~3.5 turns) | 17.5 | **$0.117** | **$0.146** |
| **Absolute worst-case free user** (5 × 12, turn cap hit every time) | 60 | **$0.402** | **$0.500** |
| **Signed-out identity, fully farmed** (2 × 8) | 16 | $0.107 | $0.133 |

Compare with v2, where those figures were *per month*. The worst case has gone
from unbounded-over-time to a hard, permanent **$0.50 per free account**.

### 6.3 Monthly Anthropic burn, by new signups

| New free signups this month | Typical | Worst case (every one caps out) |
| --- | --- | --- |
| **1,000** | $117 – $146 | $402 – $500 |
| **10,000** | $1,170 – $1,460 | $4,020 – $5,000 |
| **100,000** | $11,700 – $14,600 | $40,200 – $50,000 |

The numbers look similar to v2's table, and that is the trap in reading it:
v2's rows were **recurring monthly** costs against a **standing** user base;
these are **one-off** costs against **that month's new signups**. Over a year
with a flat 100k user base and no growth, v2 cost $140,400 and v3 costs $0.

### 6.4 The new break-even conversion

A Premium subscriber on the monthly interval contributes
`$8.4293 net − $0.8333 COGS = $7.596/month` of margin at full consumption
(the pessimistic case; most consume far less).

A free cohort's cost is now one-off, so break-even compares against a
subscriber's **lifetime** margin rather than their monthly margin:

| Assumed average subscriber life | Lifetime margin | Break-even conversion, typical free user ($0.117) | …worst-case free user ($0.50) |
| --- | --- | --- | --- |
| 12 months | $91.15 | **0.13%** | **0.55%** |
| 6 months | $45.58 | 0.26% | 1.10% |
| 3 months | $22.79 | 0.51% | 2.19% |

**Against v2's 1.4% sustained conversion requirement, the realistic v3 figure is
≈0.13% — an order of magnitude better.** Even the pessimistic combination (every
free user caps out *and* subscribers churn after three months) lands at 2.19%,
which is roughly where v2's *optimistic* case sat.

Two more ways to say the same thing, because this is the number the owner will
be asked about:

- **One Premium subscriber's single month of margin ($7.60) permanently funds
  65 typical free users** — not for a month, for their entire existence. At the
  worst case, 15.
- **The free tier stops being a liability that grows with success.** In the
  monthly model, a viral month raised the run rate forever. In the lifetime
  model it raises one month's bill and then goes quiet.

### 6.5 Guardrails, re-ranked

The lifetime cap changes which guardrails matter.

1. **The 12-turn conversation cap** (implemented). Now the difference between a
   $0.50 free user and an unbounded one *for life*. Still non-negotiable, and
   more important than before.
2. **The lifetime counter's durability** (implemented, §4.4). The cap is
   worthless if signing out resets it.
3. **Global monthly spend circuit breaker** (implemented, unchanged).
   `chat_spend_rollup` + `billing_config.free_tier_monthly_usd_cap` (default
   **$500**). Under a lifetime model this protects against a *signup* spike
   rather than a usage spike — a Product Hunt day, or a farming script. Still
   the right control, and arguably a better fit than it was.
   **Raise the $500 default before expecting more than ~4k free signups in a
   month**, or it will trip on a good day.
4. **History trimming + tool-result truncation** (§3). Cut cost per turn, so
   they multiply against every row above.
5. **Per-IP rate limit on conversation opens.** Not implemented. More valuable
   now: the payoff for farming anonymous identities no longer decays with the
   calendar.
6. **Require a verified email to chat.** Held in reserve; costs top-of-funnel.

### 6.6 What the user sees at conversation 5 — the upgrade moment

This is now a **terminal** wall, not a monthly one, and that changes the copy
completely. "Come back on the 1st" no longer exists as an out. Getting this
wrong reads as a bait-and-switch; getting it right is the single highest-value
moment in the funnel.

**Warn before the wall, not at it.** `my_chat_entitlement.upgrade_prompt`
returns `soft` at one conversation remaining precisely so the UI can:

- Show a persistent, quiet counter from conversation 3 onward — "3 of your 5
  free chats left". Never a modal.
- At conversation 5, open with an inline Bella line before the user types:
  *"Heads up — this is the last of your five free chats."*
- Require a confirm on **New chat** for free users, showing the cost:
  *"Start a new chat? That uses your last free one."*

**At the wall** (`upgrade_prompt = 'hard'`, or a 402 with
`reason: 'lifetime_conversation_limit'`), rendered as a Bella message inside the
conversation — never a toast, never a modal, never a redirect:

> **"That's the five free chats — I'm out. If you want me to keep going, Premium
> also means I start remembering your cabinet: what you own, when it runs out,
> and I'll check in before it does.**
> *Your favorites stay yours either way — nothing you've saved goes anywhere."*

Four rules for that screen:

1. **Sell memory, not messages.** The user who ran out of chats is told the
   wrong thing by "get 100 messages a month". They just demonstrated that chat
   volume is not their problem.
2. **Say the favorites are safe, explicitly, on this screen.** The moment a
   product takes something away is exactly the moment users assume it took
   everything away. §7.5 promises favorites are free forever; this is where that
   promise has to be *visible*.
3. **Never lose the message they typed.** Unchanged from v1 and still the rule
   most often broken.
4. **The rest of the app keeps working, visibly.** They should be able to close
   the panel and carry on browsing 50k products. A wall that appears to break
   the whole product converts worse than one that clearly does not.

And `BellaBubble` should stop rotating clickbait hooks once
`upgrade_prompt = 'hard'` — a hook that leads straight into a paywall is a bad
trade for the one impression it buys.

**Where region intersects.** If `sell_premium` is false (§9), there is no
upgrade to offer. `upgrade_prompt` returns `'none'` in that case and the copy
must degrade to a plain, non-selling statement — dangling a Premium CTA at
someone we will not sell to is worse than showing nothing.

## 7. Enforcement points

### 7.1 `supabase/functions/chat/index.ts` — the hard gate ⚠️ **required, still missing**

The only trustworthy enforcement point, because it is the only place holding the
Anthropic key. **The chat function as written today has no limit of any kind and
must not be deployed publicly before this lands.**

Between resolving `userToken` and entering the tool-use loop:

```ts
const deepDive = body?.deep_dive === true;
const model = deepDive ? "claude-sonnet-5" : "claude-haiku-4-5";

// User id comes from the VERIFIED token, never from the body.
const userId = userToken ? await resolveUserId(userToken) : null;
const anonHash = userId ? null : await hashAnon(body?.device_id, req);

// conversation_id is echoed back by the client; null on the first turn.
const convId = typeof body?.conversation_id === "string"
  ? body.conversation_id
  : null;

// v3: fold any pre-signup anonymous counter into the account, once (§7.3).
// Cheap, idempotent, and best-effort -- never fail a turn over it.
if (userId && body?.device_id) {
  await callRpc("chat_absorb_anon_identity", {
    p_user_id: userId,
    p_anon_key_hash: await hashAnon(body.device_id, req),
  }).catch(() => {});
}

const gate = await callRpc("consume_chat_turn", {
  p_user_id: userId,
  p_anon_key_hash: anonHash,
  p_conversation_id: convId,
  p_model: model,
  p_deep_dive: deepDive,
  // p_credits omitted -> derived from billing_config
});

if (!gate.allowed) {
  return json({
    error: "limit_reached",
    reason: gate.reason,                 // v3 adds lifetime_conversation_limit
    plan: gate.plan,
    conversation_id: gate.conversation_id,
    conversations_remaining: gate.conversations_remaining,
    conversations_remaining_lifetime: gate.conversations_remaining_lifetime,
    credit_usd_remaining: gate.credit_usd_remaining,
  }, 402);
}
```

After the loop, sum `usage.input_tokens` / `usage.output_tokens` from every
`callClaude` response (currently discarded), call
`record_chat_usage_tokens(gate.usage_event_id, …)`, and return
`conversation_id`, `turns_remaining_in_conversation`,
`conversations_remaining`, **`conversations_remaining_lifetime`** and
`credit_usd_remaining` alongside `reply` so the UI never needs a second round
trip. Full shape in §12.5.

`consume_chat_turn`'s argument list is unchanged in v3 — the lifetime identity
is derived inside the function from `auth.users.email`, not passed in, so it
cannot be spoofed by a caller and the edge function needs no new secret.

Other edits in the same file:
- `MODEL` becomes per-request, not a module constant.
- `callClaude` must surface `usage`.
- Trim `messages` to the last ~8 turns (§3 guardrail 1).
- Truncate the `ingredients` array in `get_product` (§3 guardrail 2).
- New secrets: `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) and `CHAT_ANON_SALT`.

### 7.2 What happens at the limit

The chat function returns **HTTP 402** with a machine-readable body; the UI
renders it as an in-conversation Bella message, never a toast and never a modal.

| `reason` | Free | Signed out | Premium |
| --- | --- | --- | --- |
| `conversation_turn_limit` | "We've covered a lot in this one — start a fresh chat and I'll keep going. **(2 of your 5 free chats left.)**" → **New chat** (with confirm) | same, out of 2 | n/a |
| `lifetime_conversation_limit` | §6.6 copy → Checkout | "That's the free preview. **Signing in is free and gets you five more.**" → **Sign in** | n/a |
| `monthly_conversation_limit` | only if the plan is reverted to a monthly allowance | — | n/a |
| `monthly_credit_limit` | n/a | n/a | "That's the $10 of credits for this month. Want $5 more?" → top-up Checkout |
| `deep_dive_requires_premium` | "Deep dives are a Premium thing." → Checkout | same | n/a |
| `free_tier_budget_exhausted` | "I'm over capacity for free chats this month — try again after the 1st, or Premium works right now." → Checkout | same | n/a |
| *any of the above, `sell_premium = false`* | drop the Checkout CTA entirely (§9) | | |

Three copy rules, unchanged from v1 and still right: **never lose the user's
typed message**; **show the remaining count before they hit zero**; **never
block the rest of the app**.

Note the asymmetry, which is sharper in v3 than v2. `lifetime_conversation_limit`
is *the* upgrade moment and it happens once per user, permanently. It must sell
**memory**, not more messages — see §6.6 for the copy and the reasoning. And
note that the signed-out version of the same wall sells **signing in**, not
Premium: an anonymous visitor who has used two conversations is not a
subscription prospect yet, they are an email address we do not have.

### 7.3 Signed-out metering — the acknowledged weak point

**This is the part of the lifetime design that does not work, and it is worth
saying so bluntly rather than dressing it up.**

Anonymous callers are keyed by `anon_key_hash` = SHA-256(client device id from
localStorage + `CHAT_ANON_SALT`), falling back to `x-forwarded-for` + salt. A
signed-out visitor has **no durable identity by construction** — there is
nothing about them that persists across a cleared localStorage, an incognito
window, or a different browser. "Lifetime" for an anonymous user therefore means
"until they clear storage", which is a speed bump and not a control. No amount
of schema fixes this; it is a property of not having an account.

**Recommendation, and what is implemented: 2 conversations, 8 turns each.**

The reasoning is not about cost — it is about which direction the cheapest
escape points:

- **Cost of farming is already bounded and low.** 2 × 8 = 16 turns ≈ **$0.11–0.13
  per identity**. Someone determined to run up a bill has to automate identity
  churn, which is what the `free_tier_monthly_usd_cap` circuit breaker and a
  per-IP limit on conversation *opens* exist for. The per-identity number was
  never the exposure.
- **Setting anon BELOW the signed-in allowance is the actual lever.** If anon
  gets 2 and signed-in gets 5, the cheapest way to get more Bella is to **sign
  in** — free, instant, and it gives us an address to email, which is the entire
  Premium product. If anon got the same 5 as Free (as in v2), clearing
  localStorage would be strictly easier than creating an account, and we would
  have engineered the funnel to *discourage* signup.
- **2 is enough to prove the product.** One conversation is a demo; two is
  enough to come back the next day and try a second idea. Below 2 the
  try-before-signup moment stops existing, which costs top-of-funnel for no
  saving.

So the wall for anonymous users says **"sign in, it's free"**, never "buy
Premium". Someone who has spent two anonymous conversations is not a
subscription prospect; they are a signup we have not closed.

**Partial mitigation, implemented:** `chat_absorb_anon_identity(user_id,
anon_key_hash)` folds an anonymous counter into the signed-in one, exactly once,
when the client still has its pre-signup device id on the first signed-in turn.
That closes "use 2 anonymously, then sign in for 5 more" for the honest majority
who did not clear anything. Someone who clears storage first is not caught, and
cannot be. It is a tidiness measure, not a control.

If the ledger shows farming, the fix is one `UPDATE` on `billing_plans` for the
`anon` row (or `metering_mode = 'none'` to require signup outright) — no code
change and no redeploy.

### 7.4 UX-only gates (not security)

Deep-dive toggle visibility, the credit/conversation counter, upgrade prompts.
A client can call the function directly; §7.1 is what actually holds.

### 7.5 Deliberately not gated

`OptimizedIngredientDatabase.tsx`, `ProductTable.tsx`, `IngredientTable.tsx`,
`GraphPanel.tsx`, `FaceModel.tsx`, `useProducts`, `useIngredients`,
`useProductFavorites`, `SharedFavorites.tsx`, `ProductSubmissionHelp.tsx`, and
**favorites storage and retention** — free for everyone, at every tier, with no
expiry. If a future change gates one of these, that reverses this document's
central decision and needs an explicit argument.

---

## 8. Frontend changes required

⚠️ **Not made here — another session owns `src/`.** This section is the spec.

### 8.1 The conversation identity contract

This is the part that is easy to get subtly wrong, so it is stated as a
protocol:

1. On the **first message of a chat**, the client sends `conversation_id: null`.
2. The **server** mints the id and returns it in the response (both on success
   and on a 402 that still resolved a conversation).
3. The client **stores it in component state** and sends it on **every**
   subsequent message.
4. The client **discards it** when: the user clicks "New chat"; a 402 with
   `reason: 'conversation_turn_limit'` arrives; or the panel is unmounted and
   the app reloaded.
5. The client **never generates** a conversation id, and never persists one to
   localStorage — a stale id from yesterday would just be rejected as aged out,
   burning a round trip for nothing.

Corollary: `BellaChat`'s existing "panel stays mounted so the conversation
survives close/reopen" behaviour is correct and should be preserved — closing
and reopening the panel must **not** start a new conversation, because that
would silently spend the user's quota.

### 8.2 File-by-file

| File | Change |
| --- | --- |
| `src/integrations/supabase/types.ts` | Add `billing_plans`, `billing_config`, `billing_customers`, `billing_subscriptions`, `chat_conversations`, `chat_credit_grants`, `chat_usage_events`, `billing_events`, `chat_spend_rollup`, `billing_user_region`, `email_consent_events` under `Tables`; `my_chat_entitlement` and `billing_plans_public` under `Views`; `close_my_chat_conversation`, `record_email_consent`, `set_my_declared_country`, `region_policy_for_country` under `Functions`. `consume_chat_turn`, `record_chat_usage_tokens`, `billing_region_for_user`, `set_billing_country`, `set_declared_country`, `chat_absorb_anon_identity`, `dermodel_checkin_emails_allowed` are service-role only — no client types needed. |
| `src/hooks/useEntitlement.ts` *(new)* | React Query over `my_chat_entitlement` (single row, self-filtered by `auth.uid()`), `enabled: !!session`. Everything in §12.1. Invalidate on 402, after checkout return, and after `record_email_consent`. |
| `src/hooks/useBilling.ts` *(new)* | Wraps `supabase.functions.invoke('create-checkout-session', …)` for `{ mode: 'subscription', plan: 'premium', interval }` with **all three intervals**, plus `{ mode: 'portal' }` and `{ mode: 'payment' }`; then `window.location.href = url`. |
| `src/components/Bella/BellaChat.tsx` | Hold `conversationId` in state per §8.1; send `conversation_id`, `device_id` (localStorage UUID), `deep_dive`; read them back off the response. Branch on the 402 body and render §7.2 copy **as a Bella message**, not a toast. Render the counter: conversations for free, dollars-or-messages for Premium. Add a **New chat** control that calls `close_my_chat_conversation` (signed in) and clears local state. |
| `src/components/Bella/BellaBubble.tsx` | Suppress hook rotation when `upgrade_prompt === 'hard'` — a clickbait hook that leads straight into a paywall is a bad trade for the impression it buys. |
| `src/pages/Settings.tsx` | Billing card: plan, renewal date, and either **"N of your 5 free chats left"** (no "this month" — there is no reset) or "$X.XX of $10 credits left". Buttons: **Upgrade to Premium** with an interval selector, **Manage billing** → portal, **Buy $5 more credits** → payment. Hide every buy button when `sell_premium === false`; keep **Manage billing** visible for existing subscribers regardless. Email preferences: see §12.4. Handle `?billing=success\|cancelled\|topup-success` and the `403 region_unavailable` body. |
| `src/pages/Pricing.tsx` *(new, optional)* | Public page reading `billing_plans_public` (granted to `anon`), route `/pricing`. Lead with memory, not chat volume. Hide the Premium column when `region_policy_for_country()` says the visitor's region is `avoid`. |
| `src/components/EmailConsent…` *(new)* | Wherever check-in emails are offered: when `checkin_email_consent_required` is true, show an **unticked** checkbox and call `record_email_consent` with the **exact label string** shown. §9.5. |
| `src/contexts/AuthContext.tsx` | **No change.** Entitlement changes on a different cadence than the profile and must not force an auth-context re-render. |
| `firebase.json` | **No change.** The 2026-07-18 SPA rewrite already covers `/pricing`. |

### 8.3 What the upgrade prompt needs to know

The prompt is rendered from the 402 body alone — it must not need a second
fetch, or the wall will flash empty state:

```jsonc
{
  "error": "limit_reached",
  "reason": "monthly_conversation_limit",
  "plan": "free",
  "conversation_id": null,
  "conversations_remaining": 0,
  "credit_usd_remaining": 0
}
```

From that the UI picks copy (`reason`), decides whether to show a **New chat**
button or a **Checkout** button (`reason`), and renders the count (`*_remaining`).
Anything else it wants — price, discount, feature list — comes from
`billing_plans_public`, which is anon-readable and can be prefetched at app
start.

### 8.4 Account deletion ⚠️ — and one thing it must NOT delete

`Settings.handleDeleteAccount` is still a `TODO` stub. Whenever it is
implemented it **must cancel any active Stripe subscription first**, or a
deleted account keeps getting charged. At $8.99 and an annual option this is now
a materially worse bug than it was at $5.

**It must also leave `chat_lifetime_conversations` alone.** That table has no FK
to `profiles` precisely so account deletion does not clear it (§4.4); a deletion
routine that "helpfully" tidies up every table mentioning the user would hand
back a fresh five free conversations on re-signup and quietly undo the entire
lifetime cap. The only path that should ever delete a row there is an explicit
erasure request, handled by a human who understands the tradeoff.

---

## 9. Region-conditional billing and email consent

> ⚠️ **Not legal advice, and neither the author nor the owner is a lawyer.**
> What follows is an *engineering* design: three policy tiers, a data table the
> owner can correct with an `UPDATE`, and an audit trail. The country
> assignments seeded in §9.7 are a starting point for review, not a conclusion,
> and every seeded row carries `legal_review_status = 'unreviewed'`. **Get the
> lists reviewed by someone qualified before selling internationally.** The
> value of this section is that changing a wrong answer costs one `UPDATE`
> rather than a redeploy.

### 9.1 The three tiers

| Tier | Premium offered? | Check-in emails | Where |
| --- | --- | --- | --- |
| **`always_on`** | ✅ normally | default **ON**, one-click unsubscribe on every send | US |
| **`consent_first`** | ✅ normally | default **OFF** until explicit affirmative consent, recorded | EU/EEA, UK, CH, CA, AU, NZ, SG, JP, KR, BR, IN, ZA, MX — and the unknown-country fallback |
| **`avoid`** | ❌ not offered | n/a (no subscribers, so no check-ins) | Comprehensive-sanctions countries, plus anywhere the owner decides the tax or consumer-law burden is not worth the revenue |

`avoid` **does not degrade the app**. Browsing 50k products, the ingredient
graph, favorites, `/u/<username>` sharing, product submissions and the free
chat tier all keep working. The only thing that disappears is the ability to
give us money. That is a deliberate reading of "we will not sell here" as a
commercial decision, not a blocklist.

### 9.2 Data, not `if` statements

Everything lives in **`billing_region_policy`**, keyed by ISO 3166-1 alpha-2:

```
country_code CHAR(2) PK       -- 'DE'
region_label TEXT             -- 'Germany'
policy TEXT                   -- 'always_on' | 'consent_first' | 'avoid'
sell_premium BOOLEAN          -- denormalized from policy
marketing_default_opt_in BOOLEAN
rationale TEXT                -- why this row says what it says
legal_review_status TEXT      -- 'unreviewed' | 'reviewed' | 'needs_review'
reviewed_at TIMESTAMPTZ
```

A `CHECK` constraint ties the three columns together
(`avoid ⇒ NOT sell_premium AND NOT marketing_default_opt_in`, and so on), so a
typo cannot produce an incoherent row like "avoid, but sell anyway".

**There is no country code anywhere in the application code.** Both edge
functions and both SQL gates know only the three policy names and the two
booleans. Moving Canada to `always_on`, or adding Türkiye to `avoid`, is:

```sql
UPDATE billing_region_policy
   SET policy = 'avoid', sell_premium = false, marketing_default_opt_in = false,
       rationale = '…', legal_review_status = 'reviewed'
 WHERE country_code = 'TR';
```

**The `'ZZ'` fallback row.** `ZZ` is an ISO user-assigned code, so it can never
collide with a real country. It is the answer for anyone whose country we cannot
resolve, and it is seeded **`consent_first`** — sell, but never default email
on. That is the right asymmetry: refusing to sell to someone whose IP we could
not geolocate is a self-inflicted revenue loss, whereas emailing them by default
is the thing with a downside. **Do not delete this row**; the resolver depends on
it existing.

### 9.3 How region is determined — two signals, two jobs

This is the part that is easy to get wrong by treating "the user's country" as
one fact. It is two, and they answer different questions.

| | `billing_country` | `declared_country` |
| --- | --- | --- |
| **Source** | The billing address Stripe collects at Checkout, mirrored onto the Customer (`billing_address_collection: 'required'` + `customer_update[address]=auto`) | A CDN geo header (`cf-ipcountry`, `x-vercel-ip-country`, …) if the platform gave us one; else a country the user picked; else an `Accept-Language` guess |
| **Trustworthy?** | **Authoritative.** It is what the card is billed against and what tax is computed from. | **Weak.** A VPN defeats it, a client can lie, and `Accept-Language` says what language someone reads, not where they live. |
| **Exists when?** | Only *after* someone reaches Checkout | Pre-checkout, which is the only time we have anything at all |
| **Used for** | Whether we sell. Tax. The post-hoc verification. | Which UI to render, and picking a conservative email default before we know better |

There is also **`override_country`**, operator-set, which beats both. It exists
for the VPN false positive and for the support case Stripe got wrong; without it
the strictness rule below has no pressure valve.

**Precedence:** `override > billing > declared > 'ZZ'`.

**Pre-checkout you cannot know, so pre-checkout is not where the control is.**
`create-checkout-session` re-resolves server-side on every call and refuses to
open a paid session for a non-selling region — that is the control. Hiding the
upgrade button in `src/` is a hint; anyone can `curl` the function.

### 9.4 When the two signals disagree

| Question | Rule | Why |
| --- | --- | --- |
| **Do we sell?** | The authoritative source decides — **except that an `avoid` from *either* source blocks.** | The two errors are not symmetric. A wrong block costs a support email and is fixed with `override_country`. A wrong sale into a sanctioned country is not a support email. |
| **Is email on by default?** | **Ratchet toward the stricter side**: `marketing_default_opt_in` is the logical AND of both sources. | Someone who looks EU from *any* angle is never defaulted on. |
| **What if the country later resolves to `always_on`?** | The default changes **going forward only**. Nobody who was defaulted off is retroactively opted in. | Silently flipping an existing user to opted-in because their country resolution moved is exactly the thing that reads badly in an audit. It gains one recipient and costs the credibility of every consent record you hold. |
| **What if Stripe reports an `avoid` country after checkout succeeded?** | The webhook writes `billing_subscriptions.region_blocked = true` and logs loudly. It does **not** auto-cancel. | Stripe has no billing-country allowlist for Checkout, so this is a *detect-and-remediate* control, not a prevent control — and it is honest to call it that. Silently revoking access someone paid for is a worse failure than a flag a human refunds and cancels. `billing_region_review` is the operator queue. |

Note the one asymmetry inside that asymmetry: a **top-up** purchase from an
`avoid` region has its credits **withheld** outright, because there is no
paid-access-in-flight to protect and a top-up is a fresh purchase decision.

### 9.5 Recording consent — the part that matters

A boolean is not a consent record. If we are ever asked to prove consent, the
questions are *when*, *how*, and *what exactly did they see* — and a
`checkin_emails_enabled = true` answers none of them.

So consent is an **append-only event log**, `email_consent_events`:

| Column | Why it is there |
| --- | --- |
| `action` | `granted` / `withdrawn`. Never updated in place; withdrawal is a new row. |
| `method` | `signup_checkbox` \| `settings_toggle` \| `checkout_checkbox` \| `unsubscribe_link` \| `email_link` \| `import` \| `operator` — **how** |
| `occurred_at` | **when** |
| **`consent_text`** | **The exact wording shown next to the control the user acted on.** This is the single most important column in the table. A record that cannot reproduce what the person agreed to is not much of a record. |
| `consent_version` | Lets you group everyone who saw a given wording, e.g. to re-ask after a change. |
| `policy_at_time`, `country_at_time` | Frozen at the moment of the event, so a later `UPDATE` to `billing_region_policy` cannot rewrite history. |
| `ip_hash`, `user_agent` | Corroborating detail. Optional. |

`user_id`, `policy_at_time` and `country_at_time` are **stamped server-side** by
`record_email_consent()` from the session and the resolver; the client supplies
only what it legitimately knows (which way, which control, what wording was on
screen). There is no RLS `INSERT` policy, so the log cannot be forged or edited
from the client, and no `UPDATE`/`DELETE` policy, so it cannot be rewritten.

**Precedence when deciding whether to actually send** —
`dermodel_checkin_emails_allowed(user_id)`:

1. An explicit **`withdrawn`** event always wins. Unsubscribe is absolute and
   beats everything below it, including a later region change.
2. `profiles.checkin_emails_enabled = FALSE` always wins (someone who turned it
   off in Settings).
3. An explicit **`granted`** event is sufficient **everywhere**, including
   `always_on` — someone who opted in is opted in regardless of tier.
4. No consent event at all → fall back to the region default
   (`marketing_default_opt_in`): true in `always_on`, false everywhere else.

### 9.6 ⚠️ Reconciling `20260823_bella_memory.sql` — owner action required

**That file is owned by another workstream and is not modified here.** It
currently does:

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS checkin_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```

and `bella_checkin_candidates()` gates sends on `AND pr.checkin_emails_enabled`.

**`DEFAULT TRUE` is wrong for a `consent_first` region**, and the deeper problem
is that a `NOT NULL BOOLEAN` cannot express "we have never asked this person" —
which is the state that decides everything.

**Two changes are needed in `20260823_bella_memory.sql`, both one-liners:**

1. **Make the column three-valued.** Change

   ```sql
   ADD COLUMN IF NOT EXISTS checkin_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE;
   ```

   to

   ```sql
   ADD COLUMN IF NOT EXISTS checkin_emails_enabled BOOLEAN;   -- no NOT NULL, no default
   ```

   with the semantics `TRUE` = explicitly on, `FALSE` = explicitly off,
   **`NULL` = never asked → defer to the region default**.

2. **Gate on the function, not the column.** In `bella_checkin_candidates()`,
   replace

   ```sql
   AND pr.checkin_emails_enabled
   ```

   with

   ```sql
   AND dermodel_checkin_emails_allowed(c.user_id)
   ```

   `dermodel_checkin_emails_allowed()` ships in `20260824_billing_regions.sql`
   and implements the four-step precedence in §9.5. Gating on the function
   rather than the column means the region and consent rules cannot be
   forgotten at a call site, which is the same argument `20260823` already makes
   for putting the Premium check inside the candidates function.

**What `20260824` does about the live column so you are not blocked on that
edit.** It contains a guarded `DO` block that, *if the column exists*:

- drops the `DEFAULT` and the `NOT NULL`, making `NULL` representable; and
- sets every existing `TRUE` back to `NULL` — **but only if
  `email_consent_events` is empty**, i.e. only while nobody has actually
  answered the question yet, which is the state this ships in. If consent
  events already exist it relaxes the constraints, leaves the values alone, and
  raises a `NOTICE` telling you to review them by hand.

If `20260823` has not been applied yet when `20260824` runs, the block raises a
`NOTICE` and does nothing; re-running `20260824` afterwards is safe and picks it
up. Either way, make the source change in `20260823` as well, or the next fresh
database will reintroduce `DEFAULT TRUE`.

### 9.7 The seeded lists, and their known gaps

Seeded with `ON CONFLICT DO NOTHING` so an owner correction survives a re-run.
All rows are `legal_review_status = 'unreviewed'`.

- **`always_on`: `US` only.** Deliberately narrow. Other opt-out-ish
  jurisdictions may qualify, but each one is a decision someone should make on
  purpose rather than inherit from a default.
- **`consent_first`: 30 EU/EEA + `GB CH CA AU NZ SG JP KR BR IN ZA MX` + the
  `ZZ` fallback.** The rationale column names the regime behind each grouping
  (GDPR/ePrivacy, UK PECR, CASL, Spam Act 2003, PDPA, etc.).
- **`avoid`: `CU IR KP SY RU BY AF MM VE SD`.** Comprehensive-sanctions
  countries plus a few conservative additions. Stripe would refuse most of these
  anyway; the rows exist so the app refuses first and so the decision is
  visible in one place rather than implied by a payment failure.

**Known gaps, listed because they are real and unfixed:**

1. **Sub-national sanctions cannot be expressed by a country code.** Crimea,
   Donetsk, Luhansk, Kherson and Zaporizhzhia all resolve to `UA`, which is not
   seeded and therefore falls through to `ZZ` and **sells**. Accepted for now on
   the basis that Stripe's own screening is the backstop. Revisit before doing
   anything deliberate in Ukraine.
2. **`IN` (India) is seeded `consent_first`, but is a genuine `avoid`
   candidate** on operational grounds rather than legal ones — RBI e-mandate
   rules make recurring card subscriptions painful. That is a business call, not
   a compliance one, and it is one `UPDATE` either way.
3. **Sanctions lists change.** Nothing here auto-updates. Put a recurring
   calendar reminder on re-reviewing the `avoid` rows.
4. **The `always_on` list is a US-centric reading.** A US-based operator emailing
   EU residents is subject to EU rules regardless of where the operator sits;
   the table is keyed on the *user's* country for exactly that reason, but
   whether that is sufficient is a question for the review in the warning at the
   top of this section.

### 9.8 Where it is enforced

| Point | What it does | Is it a control? |
| --- | --- | --- |
| `create-checkout-session` | Resolves region server-side; **403 `region_unavailable`** for `subscription` and `payment` modes when `sell_premium` is false. Records the geo/hint as `declared_country` (never as `billing_country`). **Fails closed** if the region cannot be read at all. | ✅ **Yes.** This is the control. |
| `create-checkout-session`, `portal` mode | **Deliberately NOT gated.** | — Someone whose region moved to `avoid` after subscribing must still be able to cancel, update a card and pull invoices. Blocking that traps them. |
| `stripe-webhook` | Writes the Stripe-collected country as `billing_country`; flags `region_blocked` on the subscription if it resolves to `avoid`; withholds top-up credits outright. | ⚠️ Detect-and-remediate, not prevent (§9.4). |
| `my_chat_entitlement.sell_premium` / `upgrade_prompt` | Tells the UI whether to render any upgrade path at all. | ❌ UX only. |
| `region_policy_for_country(cc)` | Anon-callable, so a signed-out pricing page can render correctly from a geo guess. | ❌ UX only, and marked as such. |

## 10. Open decisions for the owner

1. **Stripe vs. merchant of record.** *(now interacts with §9 — the `avoid` tier is partly a way to keep this question small.)* Stripe is assumed. If EU/UK consumers are
   a meaningful share, someone must register and remit VAT — Stripe Tax
   calculates and files but the liability stays with you. Paddle / Lemon Squeezy
   take it on entirely at roughly 5% + 50¢. At $8.99 that is ~$0.24/subscriber
   more (vs ~$0.15 at the old $5) to make VAT someone else's problem. Business
   call, not technical. Switching later rewrites both edge functions, not the
   schema.
2. ~~**The signed-out allowance.**~~ **Settled in v3**: 2 conversations of 8
   turns, lifetime, with the wall selling sign-in rather than Premium. See §7.3
   for the reasoning and for the honest statement of what it does not achieve.
3. **Grandfathering.** Existing users have had unmetered chat. Worth seeding a
   one-time `chat_credit_grants` row (say 5,000 credits, `source = 'promo'`) so
   the new limit doesn't read as a takeaway.
4. **Top-up size.** Set to $5 → 5,000 credits ($5 of credits, same 12×
   markup). An alternative is to price top-ups *below* the subscription rate to
   make them feel like a good deal, or *above* it to push subscription upgrade.
   Currently: identical rate.
5. **Does the free tier get check-in emails at all?** Currently no — it is the
   core Premium value. But one free check-in email ("your first product is
   probably running low") might be the single best conversion trigger in the
   product. Worth an experiment once replenishment tracking exists.
6. **Free-tier sizing.** 5 conversations × 12 turns is a guess, and under a
   lifetime cap it is a guess that is much harder to walk back — raising a
   monthly allowance is invisible, but raising a lifetime one has to be
   retro-granted via `bonus_conversations` or existing users see nothing. Start
   generous rather than tight. The ledger answers it within a month; both
   numbers are one `UPDATE` away, and `bonus_conversations` covers the retro
   case.
8. **Does the lifetime cap apply to users who signed up before it existed?**
   Currently yes — the migration backfills `chat_lifetime_conversations` from
   whatever `chat_conversations` rows exist (in practice none, since the gate
   has never been deployed). If there were meaningful history, the kinder
   option is to seed `bonus_conversations` for existing accounts. Related to
   grandfathering (item 3).
9. **Region lists need legal review** before selling internationally. §9.7.
7. **Charge-before vs. charge-after.** Still charging up front, so a failed
   generation still costs the user a turn. Recommend keeping it and refunding
   via `chat_credit_grants` on support requests.

---

## 11. Deployment checklist

Write-then-human-deploys. **Nothing below has been run.**

```bash
# 1. Schema  (20260818_billing.sql is ALREADY APPLIED - do not re-edit it)
supabase db push                       # applies 20260821_billing_pricing_v2.sql
                                       #     then 20260823_bella_memory.sql
                                       #     then 20260824_billing_regions.sql
#
# Migration versions are DATE-ONLY (see .claude/CLAUDE.md). 20260824 is the slot
# allocated for this work; do not add a second file with that date prefix.
#
# 20260824 is order-independent: it re-declares everything it needs from
# 20260821 with IF NOT EXISTS, and was verified applying both with and without
# 20260821 present. It is also re-runnable -- run it again after
# 20260823_bella_memory.sql lands if that one is applied later, so the
# checkin_emails_enabled default gets relaxed (section 9.6).

# 2. Stripe dashboard
#    Product "Dermodel Premium", THREE recurring prices:
#      $8.99  / month
#      $48.54 / 6 months   (interval=month, interval_count=6)
#      $91.68 / year
#    Product "$5 of Bella credits", one-time $5.00
#    Enable Stripe Tax. Configure the Billing Portal (cancel, update card).

# 3. Write the price ids into the plan catalog
#    UPDATE billing_plans SET
#      stripe_price_id_monthly    = 'price_...',
#      stripe_price_id_semiannual = 'price_...',
#      stripe_price_id_yearly     = 'price_...'
#    WHERE plan = 'premium';

# 4. Secrets
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_TOPUP_PRICE_ID=price_...
supabase secrets set STRIPE_TOPUP_CREDITS=5000        # optional, this is the default
supabase secrets set APP_ORIGIN=https://dermodel.app
supabase secrets set CHAT_ANON_SALT=$(openssl rand -hex 32)
# No new secrets for v3. The lifetime-counter salt lives in the
# chat_identity_salt table, generated at migration time -- rotating it orphans
# every counter and hands everyone a fresh free allowance, so do not.

# 5. Functions
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt   # ← required
supabase functions deploy chat                             # ONLY after §7.1

# 6. Stripe webhook endpoint
#    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
#    Events: checkout.session.completed,
#            customer.subscription.created/updated/deleted,
#            invoice.paid, invoice.payment_failed
```

Verify in test mode before going live:

- Subscribe **monthly** → `billing_subscriptions` row `status = active` →
  `my_chat_entitlement` reports `plan = premium`, `credit_usd_remaining ≈ 10.00`.
- Subscribe **6-month** and **annual** → same plan, correct
  `current_period_end` (+6mo / +12mo), still $10 of credits.
- Free account: 5 conversations open fine; the 6th returns
  `monthly_conversation_limit`. Within one conversation, turn 13 returns
  `conversation_turn_limit`. Leave a conversation idle 31 minutes → next turn
  opens a new one and decrements the count.
- Cancel via portal → `cancel_at_period_end = true` → after the period,
  `status = canceled` and entitlement falls back to `free` — **and the
  conversations used while subscribed are still counted**, so they do not get a
  fresh five.
- **Lifetime cap**: open 5 conversations, confirm the 6th returns
  `lifetime_conversation_limit`. Then **sign out, clear localStorage, sign back
  in** — the count must still be 5. Then **delete the account and re-sign-up
  with the same login** — the count must *still* be 5. That last one is the test
  that actually matters.
- **Region gate**: set `billing_user_region.declared_country = 'IR'` for a test
  user and confirm `create-checkout-session` returns **403 `region_unavailable`**
  for both `subscription` and `payment`, while `portal` still returns a URL.
  Then set `override_country = 'US'` and confirm checkout opens.
- **Consent**: with `billing_country = 'DE'`, confirm
  `checkin_email_consent_required` is true, `checkin_emails_effective` is false,
  and `dermodel_checkin_emails_allowed()` returns false. Call
  `record_email_consent('granted', 'settings_toggle', '<the exact label>')` and
  confirm it flips to true and that the row carries `policy_at_time =
  'consent_first'` and `country_at_time = 'DE'`. Then with `billing_country =
  'US'` and no consent event, confirm it is true by default.
- Confirm `chat_spend_rollup` accumulates and that
  `record_chat_usage_tokens` moves `est_cost_usd` toward the real number.

⚠️ **The service-role key rotation from the 2026-07-06 security pass is still
pending in `.claude/CLAUDE.md`.** Both Stripe functions and the chat gate depend
on the service-role key. **Rotate first, then deploy** — deploying billing
writes behind a known-compromised key is not acceptable.


---

## 12. Integration contract (frontend)

**This section is a contract.** The names, columns and shapes below are what
`src/` should be written against. They will not change without an explicit
heads-up to whoever owns `src/`. Everything here is defined in
`20260824_billing_regions.sql`.

Nothing in `src/` was modified while writing this document.

### 12.1 The one read: `my_chat_entitlement`

A **view**, `GRANT SELECT` to `authenticated`, self-filtered by `auth.uid()` —
it returns **exactly one row for the signed-in caller, or zero rows when signed
out**. There is no `user_id` filter to apply and no way to read anyone else's.

```ts
const { data } = await supabase
  .from('my_chat_entitlement')
  .select('*')
  .maybeSingle();       // maybeSingle: zero rows when signed out
```

| Column | Type | Meaning |
| --- | --- | --- |
| `user_id` | `uuid` | |
| `plan` | `text` | `'free'` \| `'premium'` (\| a legacy key) |
| `display_name` | `text` | `'Free'` / `'Premium'` |
| `metering_mode` | `text` | `'conversations'` \| `'credits'` \| `'none'` |
| **`conversation_allowance_scope`** | `text` | **`'lifetime'`** \| `'monthly'` \| `'none'`. Branch the counter copy on this — `'lifetime'` must never render the words "this month". |
| `lifetime_conversations` | `int \| null` | Plan allowance. `null` = not lifetime-gated. |
| `conversations_used_lifetime` | `int` | |
| **`conversations_remaining_lifetime`** | `int \| null` | **(a) conversations remaining.** `null` when not lifetime-gated. |
| `bonus_conversations` | `int` | Operator-granted extras, already included in the remaining figure. |
| `monthly_conversations` | `int \| null` | Only non-null if reverted to monthly. |
| `conversations_used_this_month` | `int` | |
| `conversations_remaining_this_month` | `int \| null` | |
| `conversation_turn_cap` | `int \| null` | 12 free, 8 anon, `null` Premium |
| `monthly_credits` | `int` | milli-dollars; 10000 = $10 |
| `credit_allowance_usd` | `numeric` | `10.00` — the headline |
| `credits_used_this_month` | `int` | |
| `bonus_credits` | `int` | from `chat_credit_grants` |
| `credits_remaining_this_month` | `int` | |
| `credit_usd_remaining_this_month` | `numeric` | e.g. `6.40`. Render as dollars or `/0.10` for messages. |
| `allow_deep_dive` | `bool` | |
| `includes_cabinet_memory` / `_checkin_emails` / `_surveys` / `_referrals` | `bool` | feature list |
| **`region_policy`** | `text` | **(c) region tier.** `'always_on'` \| `'consent_first'` \| `'avoid'` |
| `region_country` | `char(2) \| null` | resolved code, or `'ZZ'` |
| `region_country_source` | `text` | `'override'` \| `'stripe_checkout'` \| `'geo_header'` \| `'user_selected'` \| `'accept_language'` \| `'unresolved'` |
| **`sell_premium`** | `bool` | **false ⇒ render no purchase path at all.** |
| `checkin_emails_effective` | `bool` | Whether a check-in would actually be sent right now. Use this for the Settings toggle's *state*. |
| **`checkin_email_consent_required`** | `bool` | **(d) ask for consent?** True when the region default is off **and** the user has never answered. Show an **unticked** checkbox. |
| `checkin_email_consent_action` | `text \| null` | `'granted'` \| `'withdrawn'` \| `null` (never asked) |
| `checkin_email_consent_at` | `timestamptz \| null` | For "you agreed on 3 Mar 2026" |
| **`upgrade_prompt`** | `text` | **(b) show the upgrade prompt?** `'none'` \| `'soft'` (1 left — warn) \| `'hard'` (0 left — wall). Already returns `'none'` when `sell_premium` is false, so this one field is sufficient. |
| `subscription_status` | `text \| null` | `trialing`/`active`/`past_due` |
| `current_period_end` | `timestamptz \| null` | renewal date |
| `cancel_at_period_end` | `bool \| null` | |

**Signed-out users get zero rows.** Use `billing_plans_public` +
`region_policy_for_country()` for that case; the server enforces the anon
allowance regardless of what the client believes.

### 12.2 Public catalog: `billing_plans_public`

**View**, `GRANT SELECT` to `anon, authenticated`, ordered by `sort_order`.
Prefetchable at app start with no session.

```
plan, display_name,
price_cents_monthly, price_cents_semiannual, price_cents_yearly,
credit_allowance_usd,
lifetime_conversations, monthly_conversations, conversation_turn_cap,
allow_deep_dive,
includes_cabinet_memory, includes_checkin_emails, includes_surveys,
includes_referrals,
sort_order
```

Rows today: `free` (sort 1) and `premium` (sort 3). `anon` is not public.

### 12.3 Region tier without a session: `region_policy_for_country(p_country)`

**RPC**, `GRANT EXECUTE` to `anon, authenticated`. Takes a 2-letter code
(case-insensitive), returns exactly one row — falling back to the `'ZZ'` row for
anything unknown, so it never returns empty.

```ts
const { data } = await supabase.rpc('region_policy_for_country', { p_country: 'DE' });
// [{ country_code: 'DE', policy: 'consent_first',
//    sell_premium: true, marketing_default_opt_in: false }]
```

**UX only.** The control is server-side in `create-checkout-session` (§9.8).

### 12.4 Writes the client may make

| RPC | Grant | Signature → returns | Notes |
| --- | --- | --- | --- |
| **`record_email_consent`** | `authenticated` | `(p_action text, p_method text, p_consent_text text = null, p_consent_version text = null, p_channel text = 'checkin_email') → uuid` | `p_action`: `'granted'` \| `'withdrawn'`. `p_method`: `'signup_checkbox'` \| `'settings_toggle'` \| `'checkout_checkbox'` (others are server-side only and will raise). **`p_consent_text` must be the exact label string rendered next to the control** — pass the same constant you render, never a paraphrase. Also updates `profiles.checkin_emails_enabled`. |
| **`set_my_declared_country`** | `authenticated` | `(p_country text, p_source text = 'user_selected') → void` | Writes `declared_country` only. Cannot touch `billing_country` or `override_country`, so it can only ever make the outcome stricter (§9.4). |
| **`close_my_chat_conversation`** | `authenticated` | `(p_conversation_id uuid) → void` | The **New chat** button. Confirm first for free users — it permanently spends a conversation. |

```ts
const CHECKIN_CONSENT_TEXT =
  "Email me when a product I own is running low.";

await supabase.rpc('record_email_consent', {
  p_action: 'granted',
  p_method: 'settings_toggle',
  p_consent_text: CHECKIN_CONSENT_TEXT,     // the string you actually rendered
  p_consent_version: 'checkin-v1',
});
```

Users may also `SELECT` their own `email_consent_events` and their own
`billing_user_region` row (RLS, owner-only). Both are read-only from the client.

### 12.5 The chat function's response and its 402

The gate returns these alongside `reply` on success:

```jsonc
{
  "reply": "…",
  "conversation_id": "uuid",
  "turns_remaining_in_conversation": 9,
  "conversations_remaining_lifetime": 2,
  "conversations_remaining": null,
  "credit_usd_remaining": 0.00
}
```

And on refusal, **HTTP 402**:

```jsonc
{
  "error": "limit_reached",
  "reason": "lifetime_conversation_limit",
  "plan": "free",
  "conversation_id": null,
  "conversations_remaining_lifetime": 0,
  "conversations_remaining": null,
  "credit_usd_remaining": 0
}
```

`reason` is one of:

| `reason` | Render |
| --- | --- |
| `conversation_turn_limit` | **New chat** button + the lifetime count |
| **`lifetime_conversation_limit`** | The §6.6 wall. Checkout CTA **only if `sell_premium`**; for signed-out, a **Sign in** CTA instead |
| `monthly_conversation_limit` | Only if reverted to a monthly allowance |
| `daily_conversation_limit` | Only if a daily sub-cap is configured |
| `monthly_credit_limit` | Top-up CTA |
| `deep_dive_requires_premium` | Checkout CTA |
| `free_tier_budget_exhausted` | "over capacity this month" |
| `chat_not_available` | Plan has no chat at all |

The upgrade prompt must render **from the 402 body alone** — no second fetch, or
the wall flashes empty state.

⚠️ The conversation-identity protocol in **§8.1 is unchanged and still binding**:
the client never mints a conversation id, never persists one to localStorage,
and discards it on **New chat** or on a `conversation_turn_limit` 402.

### 12.6 Checkout, and the region 403

`create-checkout-session` accepts an optional `country` hint (2-letter,
recorded as `declared_country`, never authoritative) and returns:

```jsonc
// 403
{
  "error": "Premium isn't available in your region yet.",
  "code": "region_unavailable",
  "region_policy": "avoid",
  "region_country": "IR"
}
```

Handle `403` + `code === 'region_unavailable'` distinctly from a generic
failure: it is not an error the user can retry out of, and the copy should not
suggest they try again. Better still, use `sell_premium` from
`my_chat_entitlement` to not render the button in the first place — but handle
the 403 anyway, because the client's view can be stale and the server is the
authority.

`mode: 'portal'` is **never** region-blocked, so a **Manage billing** button is
safe to render for any existing subscriber.

### 12.7 Names that must not drift

If any of these change, the owner of `src/` gets told first:

```
views      my_chat_entitlement, billing_plans_public
rpcs       region_policy_for_country, record_email_consent,
           set_my_declared_country, close_my_chat_conversation
columns    conversations_remaining_lifetime, conversation_allowance_scope,
           upgrade_prompt, region_policy, sell_premium,
           checkin_email_consent_required, checkin_emails_effective,
           credit_usd_remaining_this_month
reasons    lifetime_conversation_limit, conversation_turn_limit,
           monthly_credit_limit, deep_dive_requires_premium,
           free_tier_budget_exhausted, chat_not_available
codes      region_unavailable
```
