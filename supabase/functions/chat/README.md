# `chat` edge function

An interactive skincare chatbot for Dermodel, grounded in the app's own Supabase
data via LLM tool use — **DeepSeek, served through OpenRouter**. The model may only
state product/ingredient facts that come back from a tool call — it never invents ingredient lists, and says so when data
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
- **Model:** `deepseek/deepseek-v4-flash` via OpenRouter's OpenAI-compatible
  `/chat/completions` (cheap/fast, supports tool calling). Override without a
  code change by setting the `CHAT_MODEL` secret to any OpenRouter model id
  (e.g. `deepseek/deepseek-v4-pro` for harder reasoning). The id is also what
  gets recorded in `chat_usage_events.model`.
- **Provider routing:** requests send `provider.require_parameters: true` (only
  providers that honour `tools` — otherwise one could silently drop them and
  answer ungrounded) and `provider.data_collection: "deny"` (skip providers that
  retain/train on prompts).
- Runs a proper tool-use loop (`tool_calls` → execute against Supabase → one
  `role: "tool"` message per call id → repeat), capped at 5 iterations.
  Malformed tool-call arguments become an error result for that call rather
  than failing the turn.

## Tools

| Tool | What it does |
| --- | --- |
| `search_ingredients(query, limit=10)` | `sss_ingredients` where `ingredient_name ILIKE %query%`, ordered by `like_count desc, product_count desc`. |
| `get_product(query)` | Finds a product by exact `product_id` or name `ILIKE`, and returns it plus its full ingredient list (joined via `sss_product_ingredients_join → sss_ingredients`, ordered by `position`). |
| `list_products_containing(ingredient_name, limit=15)` | Resolves the ingredient id, then lists products whose ingredient list includes it, ordered by product `like_count desc`. |
| `get_user_favorites()` | The signed-in caller's favorited products. RLS-scoped — see below. Returns an empty list with a note when the request is unauthenticated. |

## How favorites RLS is handled

`product_favorites` is protected by RLS (each user sees only their own rows). The
function reads the incoming request's `Authorization: Bearer <supabase access
token>` and forwards **that JWT** as the bearer on the PostgREST read, so RLS
returns only the caller's favorites. Public `sss_*` reads use the auto-injected
anon key instead. If no user JWT is present (or the header is just the anon key),
`get_user_favorites` returns an empty list with a note rather than erroring.

## Secrets / env

- `OPENROUTER_API_KEY` — set via `supabase secrets set` (read from `Deno.env`,
  never hardcoded). Create it at openrouter.ai → Keys; consider a credit limit
  on the key as a spend backstop.
- `CHAT_MODEL` — optional OpenRouter model id; defaults to
  `deepseek/deepseek-v4-flash`.
- `APP_ORIGIN` — optional; sent as OpenRouter's `HTTP-Referer` attribution
  header (defaults to `https://dermodel.app`).
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are auto-injected into edge functions;
  the anon key is sufficient for the public `sss_*` reads (no service-role key is
  used — favorites rely on the forwarded user JWT).

## Deploy (not done yet — this repo's convention is: write the function, the human deploys)

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-...
supabase functions deploy chat
supabase secrets unset ANTHROPIC_API_KEY   # once the new deploy is confirmed working
```
