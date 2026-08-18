# `bella-hooks` edge function

Builds **Bella's opening hooks** — the clickbait one-liners that float in her
bubble next to the 3D face model before the user has typed anything.

## The point: no LLM here

Every hook is a **fixed template with data slots**, filled by a few-hop
traversal over our own tables. No Anthropic call, no API key, no per-impression
cost — so the always-on surface can refresh on every page load. The LLM only
enters once the user **clicks** a hook, at which point the client sends that
hook's `prompt` to the `chat` function and the real conversation starts.

```jsonc
// Request (Authorization header optional)
POST {}

// Response
{
  "hooks": [
    { "id": "personal-pairs-with",
      "text": "I found 14 new products that would go well with COSRX Snail Mucin",
      "prompt": "I've saved COSRX Advanced Snail 96 Mucin Power Essence. What other products…",
      "kind": "personal" }
  ],
  "personalized": true
}
```

`text` is what the bubble shows. `prompt` is what gets sent to `chat` on click.

## The two cases

**Case 1 — new user / just browsing** (no favorites, or signed out):
- `browse-hot-product` — top product by `like_count`.
- `browse-hot-ingredient` — top ingredient by `like_count`.
- `browse-others-using`, plus the static arsenal: nighttime routine, safety
  check, start your cabinet, heart products to get started, sensitive skin.

**Case 2 — returning user with saved products** (favorites read with the
caller's forwarded JWT, so RLS scopes it to them):
- **Hop 1** — a random saved product's ingredient list.
- Pick a *distinctive* ingredient: `product_count` between 15 and 4000 (skips
  water/glycerin, which are in everything), highest `like_count` wins.
- **Hop 2** — other products containing it, minus what they already saved →
  *"I found N new products that would go well with X"*.
- **Hop 3** — that neighbour set minus anything containing an ingredient
  matching `%paraben%` → *"Y is like X — and it's paraben free"*.
- **Hop 2'** — `sss_co_favorites` → *"People who saved X also liked Y"*.
- Plus personal fallbacks (overlap check, what's missing) so the bubble is
  never empty.

Data-backed hooks are biased toward the front; the rest are shuffled so repeat
visitors don't get the same opener every time.

## Failure behavior

Every query goes through `tryGet`, which swallows errors and returns `[]`. A
hook that can't be built is dropped rather than failing the response — that's
also what lets the co-favorites hook **degrade silently until its migration is
applied**. The static arsenal guarantees a non-empty response either way.

## Secrets / env

None. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are auto-injected; the anon key
covers the public `sss_*` reads and the caller's own JWT covers favorites.

## Depends on

`supabase/migrations/20260819_co_favorites.sql` — the `sss_co_favorites` view
(owner-rights aggregate over `product_favorites`, same posture as
`sss_products_ranked`). Optional: without it, one hook simply doesn't appear.

## Deploy (not done yet — this repo's convention is: write the function, the human deploys)

```bash
supabase db push                          # includes 20260819_co_favorites.sql
supabase functions deploy bella-hooks
```
