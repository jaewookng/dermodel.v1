# `chat` edge function

An interactive skincare chatbot for Dermodel, grounded in the app's own Supabase
data via Claude tool use. Claude may only state product/ingredient facts that come
back from a tool call — it never invents ingredient lists, and says so when data
isn't found.

## What it does

`POST` a running conversation and get the assistant's reply:

```jsonc
// Request body
{ "messages": [{ "role": "user", "content": "What's in COSRX Snail Mucin?" }] }

// Response
{ "reply": "…" }
```

- `messages` is the full conversation (roles `user` / `assistant`, string content).
- Returns **JSON `{ reply }`** (non-streaming). Streaming was intentionally deferred
  for v1: the tool-use loop is simpler to run to completion server-side and hand
  back one final answer. It can be added later by switching the final assistant
  turn to SSE.
- **Model:** `claude-haiku-4-5` (cheap/fast, good enough for grounded lookup +
  phrasing). Swap to `claude-sonnet-5` for harder reasoning — see the `MODEL`
  constant in `index.ts`.
- Runs a proper tool-use loop (`tool_use` → execute against Supabase →
  `tool_result` → repeat), capped at 5 iterations.

## Tools

| Tool | What it does |
| --- | --- |
| `search_ingredients(query, limit=10)` | `sss_ingredients` where `ingredient_name ILIKE %query%`, ordered by `like_count desc, product_count desc`. |
| `get_product(query)` | Finds a product by exact `product_id` or name `ILIKE`, and returns it plus its full ingredient list (joined via `sss_product_ingredients_join → sss_ingredients`, ordered by `position`). |
| `list_products_containing(ingredient_name, limit=15)` | Resolves the ingredient id, then lists products whose ingredient list includes it, ordered by product `like_count desc`. |
| `get_user_favorites()` | The signed-in caller's favorited products. RLS-scoped — see below. Returns an empty list with a note when the request is unauthenticated. |

## Bella's guidelines (the system prompt)

Everything about how Bella talks lives in the `SYSTEM_PROMPT` constant near the
top of `index.ts` — there is no other config. Edit it and redeploy.

Current rules (2026-09-17):

- **1–2 technical terms per answer**, chosen because they explain the mechanism
  behind the question (humectant, occlusive, pKa…). Ingredient/INCI names don't
  count. Each term is glossed once in plain words where it first appears;
  everything around it stays simple. The goal is that the reader feels slightly
  stretched and understands.
- **Target persona**: already curious, reads ingredient lists, not a chemist.
- **Cabinet-aware by default**: for a signed-in user the function reads
  `my_cabinet` (20260823) with the caller's JWT before the first model call and
  appends a "User's cabinet" section (product, product_id, AM/PM, frequency,
  days of supply) to the system prompt. Bella is told to check that list first
  for any product- or ingredient-specific question and answer in the context of
  what the person already uses, calling `get_product` on a cabinet
  `product_id` when it needs the actual ingredient list. Signed out, or if the
  view is missing / the read fails, the section is simply absent.

## How favorites RLS is handled

`product_favorites` is protected by RLS (each user sees only their own rows). The
function reads the incoming request's `Authorization: Bearer <supabase access
token>` and forwards **that JWT** as the bearer on the PostgREST read, so RLS
returns only the caller's favorites. Public `sss_*` reads use the auto-injected
anon key instead. If no user JWT is present (or the header is just the anon key),
`get_user_favorites` returns an empty list with a note rather than erroring.

## Secrets / env

- `ANTHROPIC_API_KEY` — set via `supabase secrets set` (read from `Deno.env`,
  never hardcoded).
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are auto-injected into edge functions;
  the anon key is sufficient for the public `sss_*` reads (no service-role key is
  used — favorites rely on the forwarded user JWT).

## Deploy (not done yet — this repo's convention is: write the function, the human deploys)

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy chat
```
