# dermodel — fastest-to-entry GTM (2026-09-15)

Ordered by **time to first real user**, not by ceiling. Everything here is
$0 or near-$0 and uses assets that already exist in the product. The drama
(`docs/drama/`) is the long play; this is what runs while it's being built.

## 0. Gate before traffic (day 0 — non-negotiable)

Sending traffic to an unmetered chat spends Anthropic money per stranger.
Before *any* of the below:

- roll the two exposed keys, `supabase db push` (20260827 + 20260828)
- `supabase secrets set CHAT_ANON_SALT=…` → `supabase functions deploy chat`
- Firebase Analytics: define two events — `bella_first_message`,
  `favorite_first` — that is **activation**. Nothing else matters yet.

## 1. Founder-led, where the audience already is (day 1–3)

No fake accounts. One account, your name, "I built this".

| Where | Move | Note |
|---|---|---|
| r/SkincareAddiction, r/AsianBeauty, r/30PlusSkinCare, r/SkincareAddicts | Answer ingredient questions **with data** ("that serum lists niacinamide 3rd, and 4 of the other 12 ingredients are in your cleanser too") and link only when the answer *is* the link | Read each sub's self-promo rule first; most allow a launch post once with mod approval |
| Product Hunt | Launch on a Tue/Wed. Angle: "50k products, ingredient-level AI that only answers from the database" | The 3D face is the thumbnail; Bella is the pitch |
| Show HN | "Show HN: a grounded skincare AI that can't hallucinate an ingredient" | HN cares about the *how* — zero-LLM hooks, tool-use over your own tables |
| Skincare Discords | Same as Reddit: be useful first | |

Expected: tens to low hundreds of signups, and — more valuable — the first
ten real Bella conversations to read.

## 2. Campus (week 1) — the fastest physical channel you have

You're at UT Austin; the target demographic (women 16–36, educated,
cosmetics-literate) is the campus. Cost: printing.

- QR flyer, one line: **"Does your serum fight your moisturizer? Ask Bella."**
  → `/` with `?ref=ut` (so analytics can attribute it).
- Pre-health, chem/biochem, and cosmetics/beauty student orgs — offer a
  10-minute demo; give the org **a shared favorites page** (`/u/<org>`) as
  "our members' picks".
- Sorority/dorm bulletin boards if allowed. Don't spam mailing lists.

## 3. Make the existing share loop actually spread (week 1–2, small eng)

`/u/<username>` favorites pages already exist; they just don't unfurl.

- **OG tags per share page** (title "jaewookng's skincare picks", image of
  the top 3 products). The app is an SPA, so this needs a tiny prerender
  step or a Firebase function for `/u/*` — half a day.
- **Cabinet share**: "my routine" as a public page. Routines are what people
  actually screenshot and post; favorites lists are not.
- **Referral via `bonus_conversations`** (already in the schema): "invite a
  friend, you both get +2 conversations." Zero new tables.

## 4. One free, no-signup, no-LLM tool that is inherently shareable (week 2, eng)

**"Conflict check"**: pick two products → ingredient overlap + a short
deterministic warning list (the same few-hop traversal `bella-hooks` uses).
No login, no chat, so it costs nothing per visit and can be linked freely
from Reddit answers. It's also the exact scene the drama pilot is built
around, so the two channels point at the same page.

## 5. Micro-creator seeding, done honestly (week 2–3)

- 20 skincare creators at 5–50k followers (YouTube/TikTok/IG). Gift 12
  months Premium, **no posting obligation, disclosure required if they do**.
- Pick people who already do ingredient-list breakdowns — the product does
  their prep work for them, which is the actual pitch.
- Track with per-creator `?ref=` codes, not promises.

## 6. Programmatic SEO (start week 3, compounds for a year)

The one durable channel. `sss_products` × `sss_ingredients` is ~50k product
pages and ~21k ingredient pages nobody has to write:

- `/p/<slug>` — product, full ingredient list, "products that share what
  makes this work" (already computed for the check-in emails)
- `/i/<slug>` — ingredient, top products, co-occurring ingredients
- Needs static/prerendered HTML on Firebase Hosting (SPA routes are invisible
  to crawlers), a sitemap, and Search Console. ~2 days.
- Don't hotlink SkinSafe images into these pages' OG tags — that's
  redistribution, which the image posture explicitly forbids.

## What to watch (one number per stage)

| Stage | Metric | Kill/continue |
|---|---|---|
| Visit → signup | signup rate | <3% → landing copy is wrong, not the channel |
| Signup → activation | first Bella message *or* first favorite | <40% → the intro isn't landing |
| Activation → 2nd session | D7 return | this is the number that decides whether to spend on anything |
| Free → Premium | conversion after `lifetime_conversation_limit` | payment-model break-even is ≈0.13% — anything above 1% means push harder |

## Explicitly not doing

- Paid ads before D7 return is known — you'd be buying traffic to a leaky
  funnel.
- Faux accounts / seeded testimonials (FTC + platform bans; decided earlier).
- Pinterest product pins — needs images we're allowed to redistribute.
