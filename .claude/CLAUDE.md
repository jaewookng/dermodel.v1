# Project Independence and UI Enhancement Plan for Dermodel v2

## 📋 INSTRUCTIONS FOR CLAUDE

**IMPORTANT**: Before making ANY edits to this project:
1. **Always read this CLAUDE.md file first** to understand the current project status, completed work, and planned next steps
2. **After completing any edits**, update this file with:
   - What was changed and why
   - Current status of affected components
   - Any new issues discovered or next steps identified
3. **Maintain the project roadmap** by updating the relevant sections below

This document serves as the single source of truth for project status and development direction.

### ⚠️ Migration naming: one migration per date
Supabase derives a migration's **version** from the leading digits of the
filename, and this repo names them `YYYYMMDD_slug.sql` — so the version is
**date-only** and two migrations dated the same day collide. Hit on 2026-08-18:
`20260818_billing.sql` and `20260818_co_favorites.sql` both resolved to version
`20260818`; the first applied and recorded, the second failed with
`duplicate key ... schema_migrations_pkey` and **rolled back entirely** (verified
the view was absent afterward, so no partial state). Fix was renaming the second
to `20260819_co_favorites.sql`. When adding a migration, check for an existing
file with the same date prefix and bump the date (or switch to full
`YYYYMMDDHHMMSS` timestamps) before pushing.

---

This document outlines the steps to remove "Lovable" branding from your project and to enhance the 3D facial model's user interface for a more delightful experience.

---

## 🤖 FEATURE: Bella — Grounded AI Assistant (2026-07-20, UI 2026-08-18)

**Status**: ✅ **CODE COMPLETE — needs `db push` + 2 function deploys**

### ⚠️ Action Required
```bash
supabase db push                             # includes 20260819_co_favorites.sql
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy chat               # (already deployed as of 2026-08-18)
supabase functions deploy bella-hooks        # NOT yet deployed
```

### Bella's opening hooks (2026-08-18) — server-side, ZERO LLM
The assistant is named **Bella** and is immediately useful before the user types
anything. **`supabase/functions/bella-hooks`** (NEW) returns clickbait one-liners
built from **fixed templates with data slots**, filled by few-hop traversal over
our own tables. No Anthropic call, no per-impression cost — the LLM only starts
when the user **clicks** a hook, which sends that hook's `prompt` to `chat`.

Response: `{ hooks: [{ id, text, prompt, kind }], personalized }`.
`text` shows in the bubble; `prompt` is what gets asked on click.

- **Case 1 — new/browsing** (no favorites or signed out): hottest product and
  ingredient by `like_count`, plus a static arsenal (nighttime routine, safety
  check, start your cabinet, heart products to get started, sensitive skin).
- **Case 2 — returning w/ favorites** (RLS-scoped via forwarded JWT):
  - Hop 1: a random saved product's ingredients.
  - Picks a *distinctive* ingredient (`product_count` 15–4000, so not
    water/glycerin), highest `like_count`.
  - Hop 2: other products with it, minus already-saved → *"I found N new
    products that would go well with X"*.
  - Hop 3: that set minus anything matching `%paraben%` → *"Y is like X — and
    it's paraben free"*.
  - Hop 2': `sss_co_favorites` → *"People who saved X also liked Y"*.
  - Plus personal fallbacks (overlap check, what's missing).
- Every query goes through `tryGet` (swallows errors → `[]`), so an unbuildable
  hook is dropped rather than failing the response — which is also how the
  co-favorites hook **degrades silently until its migration is applied**.
- **`supabase/migrations/20260819_co_favorites.sql`** (NEW): `sss_co_favorites`
  view — owner-rights self-join on `product_favorites` giving
  `(product_id, also_product_id, co_count)`. Same aggregate-only/anon-GRANT
  posture as `sss_products_ranked`; no `user_id` exposed. ⚠️ Privacy note in the
  file: at low user counts `co_count = 1` is a weak single-basket signal —
  raise the caller-side threshold as the user base grows.
- **`src/hooks/useBellaHooks.ts`** (NEW): React Query wrapper, 5-min
  `staleTime`, no refetch on focus, keyed by user id so it re-fetches on
  sign-in/out.

### Bella's UI (2026-08-18) — anchored to the Spline camera, draggable
Renamed from the earlier "derma" game-style dialogue; `src/components/Chat/`
was replaced by **`src/components/Bella/`**.

- **`BellaBubble.tsx`**: hangs off the **left** of the face (chirality flipped
  from the first pass), tail pointing right at it. Rotates through the hooks
  every 8s with a fade; falls back to three dots while they load. Soft glass
  card — thin rose border, gradient fill, top highlight, slow sheen sweep, soft
  rose shadow (no more thick dark game borders).
- **`BellaChat.tsx`**: glass panel, rose/pink palette, "Bella" speaker chip.
  **Draggable from anywhere that isn't a control** (pointer capture, clamped to
  the viewport; `input/textarea/button/a/[data-no-drag]` are excluded, and the
  transcript carries `data-no-drag` so it stays scrollable/selectable).
  ⚠️ The drag transform lives on an **outer** wrapper and the entrance animation
  on an **inner** one — same element and the keyframes clobber the drag offset.
- **Message plumbing**: messages carry `local` (shown, never sent — greeting and
  hook lines) and `hidden` (sent, never shown — the prompt behind a hook).
  `toApiMessages()` drops `local` turns and any assistant turns still leading
  the list, since the Anthropic API requires the conversation to start with a
  user turn. Clicking a hook seeds `[assistant(hook text, local), user(prompt,
  hidden)]` and auto-sends, so Bella appears to just start answering.

### Face anchoring — `FaceModel` now publishes a projected anchor
`FaceModel` takes `onAnchorChange?: (FaceAnchor | null) => void` and emits
`{ x, y, scale }` in canvas space, so the bubble tracks the model's real
position and apparent size instead of a hardcoded percentage.

- **Landmarks, not transforms**: every `face_*` zone mesh sits at the scene
  origin (the shape is in the geometry; the parent rig `meshed_face_model`
  carries a 46× scale), so object world positions are all identical and
  useless. `zoneCentre()` takes each zone's **geometry bounding-box centre**
  and applies its `matrixWorld`. Forehead→chin distance is the apparent size;
  `scale = span / REFERENCE_FACE_SPAN_PX (210)`, clamped 0.6–1.8.
- **Guarded fallback**: Spline owns the camera (it isn't a
  `THREE.PerspectiveCamera` and there are two THREE instances in the bundle), so
  a stale matrix could fling the bubble off-screen. If the projection lands
  outside believable NDC bounds, the anchor falls back to viewport-relative
  (32% × 44%, scale from height). The overlay can't end up somewhere absurd.
- **Update loop**: rAF throttled to ~20fps, backed by a 500ms interval plus
  immediate calls at 0/150/600ms — rAF is paused entirely in a hidden tab, so
  the interval is what lets the overlay correct itself. Both are torn down in
  `__raycasterCleanup`. Viewport size falls back through
  `rect → clientWidth → innerWidth → documentElement.clientWidth`.

### Verified (dev server, 2026-08-18, live `chat` function)
✅ Bubble renders left of the face, pink/glass, hook text visible
✅ Click hook → panel opens, hook line shown, prompt auto-sent, **real grounded
reply** ("Niacinamide … found in over 5,700 products in the Dermodel database")
with **bold** rendered ✅ follow-up turn works on top of the hidden seed message
✅ panel drags and stays where dropped ✅ tsc + build clean
⚠️ **Not verified live**: the projected anchor path. The in-app browser pane
reports `document.hidden = true` with 0×0 rects and `innerWidth = 0`, so rAF
never runs and every emit hits the fallback; Chrome MCP wasn't connected. What
was confirmed by direct scene probing: zone meshes are all at origin, geometry
centres do separate forehead from chin (world y 5.8 vs −37.3), and the camera
exposes `projectionMatrix`/`matrixWorldInverse`. **Check the bubble tracks the
face on a real page load and retune `REFERENCE_FACE_SPAN_PX` if it's off.**

### Superseded first pass (2026-08-18) — Pokemon/game-style, opt-in
Deliberately not a forced chat widget: a **"..." speech bubble**
(`src/components/Chat/ChatBubble.tsx`) floats next to the Spline face
(bobbing, staggered bouncing dots, thick game-style border + offset shadow,
tail pointing at the face). It lives inside the FaceModel transform container
in `Index.tsx` (absolute `left-[44%] top-[14%]`) so it **follows the face**
when the graph panel shifts it left. Clicking it opens
**`src/components/Chat/ChatPanel.tsx`** — a game dialogue box (bottom-left,
thick border, violet "derma ✦" speaker tag, close X):
- **Typewriter effect** for the newest assistant reply (2 chars/18ms,
  blinking ▮ caret); older messages render instantly (`animateFromIndex`).
- Greeting message is client-side flavor text and is **stripped before
  sending** (`messages.slice(1)`) so the model never sees it.
- Calls `supabase.functions.invoke('chat', { body: { messages } })` —
  forwards the user JWT automatically (favorites tool works when signed in).
- Non-streaming `{ reply }` per the edge function's v1 contract; "..."
  bubble shown while waiting; graceful error line on failure.
- Panel **stays mounted** (hidden with CSS) so the conversation survives
  close/reopen; bubble hides while the panel is open.
- Minimal markdown: `**bold**` rendered via `renderBold`; rest is
  `whitespace-pre-wrap` plain text.
- Enter-to-send handled BOTH via form `onSubmit` and input `onKeyDown`
  (both `preventDefault`) — belt-and-braces against native form submission
  reloading the SPA.
- Animations (`chat-bubble-float`, `chat-dot-bounce`, `chat-panel-in`,
  `chat-caret-blink`) added to `src/index.css`.

### Verified (dev server, 2026-08-18, live edge function)
✅ Bubble floats by the head; click → panel with typewriter greeting
✅ Real grounded reply ("what products contain snail mucin?" → 1 product,
bold rendered) ✅ close → bubble returns; reopen → conversation intact
✅ tsc + build clean

**Original plan (2026-07-20):**

Interactive skincare chatbot **grounded in our own data**, not a third-party
bot platform (evaluated Botpress; rejected because the value is live queries
over `sss_ingredients` / `sss_products`, which a visual flow builder makes
clunky — DIY with an API key gives tight DB integration, no vendor lock-in,
and low per-conversation cost).

**Architecture (DIY, fits the existing React + Supabase stack):**
- **`supabase/functions/chat`** (NEW Edge Function, Deno) — calls the Claude
  API with **tool use**; the model decides when to query our tables and the
  function runs the query. Mirrors the structure of the existing
  `notify-product-submission` function (CORS, env, error handling).
  - Tools: `search_ingredients(query)`, `get_product` (+ its ingredients via
    `sss_product_ingredients_join`), `list_products_containing(ingredient)`,
    and `get_user_favorites` (RLS-scoped by forwarding the caller's JWT).
  - Public `sss_*` reads via anon/service; per-user favorites via the caller's
    `Authorization` header so RLS applies.
  - Secret: `ANTHROPIC_API_KEY` (`supabase secrets set`). Model: Claude
    Haiku 4.5 for cost/speed; Sonnet for the reasoning-heavy asks.
- **React chat panel** (follow-up) — small streaming chat UI in the right
  panel; reuses the same canonicalized data the rest of the app uses.

Depends on `20260721_ingredient_canonicalization` (clean ingredient names make
tool answers accurate). ⚠️ Not deployed: needs `supabase functions deploy chat`
+ the secret, per the project's write-then-human-deploys convention.

---

## 🗑️ CLEANUP: Drop ingredient_stats (2026-07-20)

**Status**: ✅ migration written — apply with `supabase db push`

`ingredient_stats` in the live DB was a hand-created relation (predates the
tracked migration history) duplicating `sss_ingredients_ranked` minus
`like_count` — verified identical row count (21,192) and values, zero
references in app/scripts/migrations, and it was exposed to anon.
**`supabase/migrations/20260720_drop_ingredient_stats.sql`** drops it via a
DO block (handles view/matview/table, idempotent).

---

## ⭐ FEATURE: Username Share Links (2026-07-19)

**Status**: ✅ **CODE COMPLETE — requires DB migration**

Share links are now `dermodel.app/u/<username>` (URL-encoded; falls back to
the id when username is null). Legacy `/u/<user_id>` UUID links keep working.
- **`supabase/migrations/20260719_username_share_links.sql`**: dedupes
  existing usernames case-insensitively (oldest keeps the name, later ones
  get `-N` suffix), adds unique index on `lower(username)`, and rewrites
  `handle_new_user()` to pick the next free suffix on signup collision
  (keeps SECURITY DEFINER + pinned search_path).
- **`SharedFavorites.tsx`**: route param is now `:handle`; UUID-shaped
  handles query `user_id`, everything else does a case-insensitive
  literal `ilike` on `username` (wildcards escaped).
- **`ShareFavoritesButton.tsx`**: generates the username link.
- ⚠️ Caveats: renaming a username breaks previously shared username links
  (uuid links survive); once the unique index is live, a Settings username
  update to a taken name will error — no friendly message yet.

### Verified (dev server, 2026-07-19, live data)
✅ `/u/jaewookng` → "jaewookng's Favorite Products" + product list
✅ `/u/JAEWOOKNG` (case-insensitive) ✅ legacy `/u/<uuid>` still resolves
✅ unknown handle → graceful empty state ✅ tsc + build clean

### ⚠️ Action Required
```bash
supabase db push          # includes 20260719_username_share_links.sql
```

---

## ⚡ PERF: Server-Side Product Pagination + Search (2026-07-19)

**Status**: ✅ **COMPLETE — no DB change needed**

The Products tab previously fetched **all ~50k rows** from
`sss_products_ranked` in 51 sequential 1000-row batches (~15+ MB, re-run on
every tab mount via `refetchOnMount: 'always'`), then searched/paginated
client-side. Now:
- **`useProducts(filters)`** (`useIngredients.ts`): takes
  `{ search, page, limit }`, returns `{ data, totalCount }`. One request per
  page: explicit column select + `{ count: 'exact' }`, `.ilike` on
  `product_name` for search, `.order(like_count desc, product_name asc)`
  (matches the 20260603 composite index), `.range()` for the page.
  `placeholderData: keepPreviousData` prevents flicker while paging/typing;
  dropped the forced refetch (inherits app default).
- **`OptimizedIngredientDatabase.tsx`**: products search debounced 300ms via
  existing `useDebounce`; client-side filter/slice removed; pagination uses
  the server `totalCount`.
- Deep links (Favorites/shared page → product card) go through the same
  server-side search path.

### Verified (dev server, 2026-07-19)
✅ Tab load = ONE ~10-row request (was 51) ✅ search "dokdo" → 1 ilike
request, "1-10 of 17", correct rows ✅ page 2 → "11-17 of 17" ✅ tsc + build

---

## ⭐ FEATURE: Shareable Favorites + Deep Links (2026-07-17)

**Status**: ✅ **CODE COMPLETE — requires DB migration**

### Overview
1. Product names on **/favorites** are clickable → main page opens the
   Products tab with that product's card expanded.
2. A **Share icon** (box-with-up-arrow, top right of /favorites) opens a
   dialog that enables sharing (opt-in), shows the public link
   `/u/<user_id>`, copies it, and can "Stop sharing". The public page shows
   "{username}'s Favorite Products" to anyone — no login required.

### Components
- **`supabase/migrations/20260717_public_favorites.sql`**: adds
  `profiles.favorites_public BOOLEAN DEFAULT false`; creates
  `public_favorites` view (owner-rights, same pattern as sss_*_ranked) that
  joins favorites+profiles+products **only where favorites_public** and
  exposes username + product fields (incl. image) — never email. GRANT
  SELECT to anon+authenticated.
- **Deep-link mechanism**: `navigate('/', { state: { tab: 'products',
  openProduct: { id, name } } })`; Index passes `initialProduct` to
  `OptimizedIngredientDatabase`, which sets tab/productSearch/
  expandedProductId. Used by both Favorites and SharedFavorites.
- **`src/components/ShareFavoritesButton.tsx`** (NEW): Share icon + dialog;
  flips `favorites_public` via direct profiles update; clipboard copy.
- **`src/pages/SharedFavorites.tsx`** (NEW, route `/u/:userId`, public):
  reads `public_favorites` via publicClient; product thumbnails; clickable
  names → deep link; graceful "private, empty, or doesn't exist" state.
- `types.ts`: profiles.favorites_public + public_favorites view;
  AuthContext fallback profile includes `favorites_public: false`.

### Verified (dev server, 2026-07-17)
✅ `/u/<unknown-id>` renders graceful private/empty state (pre-migration)
✅ Deep link (simulated navigate state with real product id) → Products tab,
search prefilled, correct card expanded with ingredients + image block
✅ tsc + build clean
⚠️ Share dialog flow needs a signed-in session — untested in-browser; verify
after `db push` (flip on → link works, "Stop sharing" → /u page goes empty).

### ⚠️ Action Required
```bash
supabase db push          # includes 20260717_public_favorites.sql  [DONE 2026-07-17]
firebase deploy --only hosting   # SPA rewrite fix — see below
```

### 🔧 FIX (2026-07-18): Share links 403'd — hosting rewrite, not RLS
`/u/<id>` returned Google's "Forbidden" page: firebase.json rewrote `**` to
the IAM-protected Cloud Run service `dermodel-v1` (v1 leftover), so ANY
hard-loaded SPA route (including /favorites on refresh) 403'd before the app
loaded; `/` worked only because dist/index.html is served statically.
Verified RLS was fine (anon fetch of public_favorites returned the user's
shared rows). Fix: standard SPA rewrite `** → /index.html`. Needs
`firebase deploy --only hosting` (dist freshly rebuilt).

---

## ⭐ FEATURE: Product Images — SkinSafe Hotlinks (2026-07-16, FINAL DESIGN)

**Status**: ✅ **CODE COMPLETE — requires DB migration + one-time import**

### Overview
Every product card shows its photo at the top of the expanded row, above the
ingredients list. Images are **hotlinked** from the SkinSafe CDN (the origin
of the sss.csv dataset) — **never copied or proxied** (server-test posture).
A visible credit line ("Image: cdn1.skinsafeproducts.com") links to the
source product page. This design SUPERSEDES the earlier OBF/CSE pipeline
(built then removed in the same session — see git history if ever needed).

### Components
- **`supabase/migrations/20260715_product_images.sql`**: adds
  `image_source_url` + `image_attribution` to `sss_products`; re-creates
  `sss_products_ranked` including them (with existing `image_url`).
- **`scripts/import_skinsafe_images.py`** (one-time, re-runnable): reads
  `/Users/jaewookang/Downloads/sss.csv` (`image_url` + `product_url` cols),
  matches DB products by exact `product_name`, bulk-upserts via PostgREST
  (`resolution=merge-duplicates`, 500/batch). `--dry-run` works with anon key.
- **`src/components/ProductImage.tsx`**: rendered in `ProductTable` expanded
  row above `ProductIngredients`. `referrerpolicy="no-referrer"` (avoids
  referer-based hotlink blocks), `onError` hides the whole block, lazy
  loading, credit link below. Renders nothing when `image_url` is null.
- `Product` type + `useProducts` mapping carry `image_url` /
  `image_source_url` / `image_attribution`.

### Verified (2026-07-16)
✅ Dry-run: **50,346 / 50,346 products matched** to an image link (100%)
✅ SkinSafe CDN serves to referer-less browser embeds (800×600 loads in-app)
✅ Image + credit render above "Ingredients (N)" in expanded card
✅ Null image_url → card renders normally with no image block
✅ tsc + build + py_compile clean

### ⚠️ Action Required
```bash
supabase db push                                   # includes 20260715
export SUPABASE_SERVICE_KEY=...                    # post-rotation key
python3 scripts/import_skinsafe_images.py          # one-time seed (~2 min)
```

### Risk posture (accepted 2026-07-16)
Hotlinks only — no reproduction. If SkinSafe blocks or churns URLs, images
degrade gracefully (onError hides them); recovery would be re-running the
import with fresh URLs or building an alternative source. Do NOT copy or
proxy these images through our own infrastructure.

---

## 🗑️ REMOVED: OBF/CSE Image Pipeline (built + removed 2026-07-15/16)

Superseded by the SkinSafe hotlink design above before ever being deployed.
Removed: `scripts/fetch_product_images.py` (Open Beauty Facts bulk matcher),
`scripts/hotlink_product_images.py` (Google CSE bulk hotlinker),
`supabase/functions/resolve-product-image` (on-demand resolver),
`.github/workflows/product-images.yml`. No DB objects were ever created for
it (the earlier 20260715 draft with storage bucket + image_license +
image_checked_at was rewritten before `db push`). Recoverable from git
history if OBF licensed-image upgrading is ever wanted again.

---

## ⭐ FEATURE: User Product Submissions (2026-07-09)

**Status**: ✅ **CODE COMPLETE — requires DB migration + edge function deploy**

### Overview
Users can suggest products missing from the database. A "?" icon next to the
**Product Database** heading shows a tooltip ("Don't see your product? Submit
it here"); "here" opens a centered dialog with an optional product name and a
required product link. On success the dialog shows the thank-you message and an
email is sent to **admin@dermodel.app**.

### Architecture
- **`src/components/ProductSubmissionHelp.tsx`** (NEW): HelpCircle + Radix
  tooltip + shadcn Dialog. Validates the URL client-side (http/https only).
- **Submission flow**: client inserts directly into `product_submissions`
  (source of truth — works even if the email function is down), then fires the
  `notify-product-submission` edge function best-effort for the admin email.
  Thank-you shows when the DB insert succeeds; insert failure shows an error.
- **`supabase/migrations/20260709_product_submissions.sql`** (NEW): table with
  `product_url` (≤2048 chars), `product_name` (≤200), nullable `user_id`,
  `status` (default `'pending'`). RLS: INSERT-only for anon+authenticated
  (`user_id` must be null or own uid); no SELECT — review via dashboard.
- **`supabase/functions/notify-product-submission/index.ts`** (NEW): Deno edge
  function, CORS-enabled, re-validates input, sends email via **Resend** API to
  admin@dermodel.app.
- **`types.ts`**: added `product_submissions`.
- **`OptimizedIngredientDatabase.tsx`**: renders `<ProductSubmissionHelp />`
  next to the Product Database h2.

### UI polish (2026-07-10)
- Tooltip pops to the **right**, rectangular, split into two lines after
  "product?" ("Don't see your product?" / "Submit it here").
- **Product rows**: like count now renders as a plain number inside
  `ProductFavoriteButton` (new `likeCount` prop), next to the heart; the
  separate rose heart+count span in `ProductTable` was removed; counts of 0
  are not shown. (Ingredient rows keep their single rose heart+count — there
  is no favorite button for ingredients — and already hide 0s.)

### Verified (dev server + browser)
✅ Tooltip opens, "here" opens centered dialog ✅ URL validation error shows
✅ Bad insert shows graceful error (table 404s until migration applied)
✅ tsc + build clean

### ⚠️ Action Required
```bash
supabase db push                                        # includes 20260709
supabase functions deploy notify-product-submission
supabase secrets set RESEND_API_KEY=re_...              # resend.com key
```
Also verify `dermodel.app` as a sending domain in Resend (function sends from
`submissions@dermodel.app`). Until the migration is applied, submissions fail
gracefully with an error message.

---

## ⭐ FEATURE: Capped Product List in Ingredient Cards (2026-07-06)

**Status**: ✅ **COMPLETE — no DB change needed**

Expanded ingredient rows previously fetched **every** product containing the
ingredient (hundreds of rows for common ingredients). Now:
- **`useIngredientProducts.ts`**: takes a `limit` (`number | null`); when set,
  queries with `.range(0, limit - 1)`; `null` fetches everything. Always uses
  `{ count: 'exact' }` and returns `{ products, totalCount }`;
  `placeholderData: keepPreviousData` keeps the visible list stable while the
  full list loads.
- **`IngredientProducts.tsx`**: renders the first 10 with a
  "See all N" button that switches to the unlimited fetch; header shows the
  true total (`Products (totalCount)`).

---

## 🔒 SECURITY + QOL PASS (2026-07-06)

**Status**: ✅ **CODE COMPLETE — ⚠️ TWO MANUAL ACTIONS REQUIRED (see below)**

### 🚨 CRITICAL: Leaked keys — ROTATE IMMEDIATELY
The Supabase **service-role key** was hardcoded (as an env-var fallback) in
`load_to_supabase.py` and `scripts/populate_papers.py`, both committed to the
**public** GitHub repo (`jaewookng/dermodel.v1`). A Semantic Scholar API key was
also hardcoded in `populate_papers.py`. The hardcoded values are now removed
(scripts hard-fail without `SUPABASE_SERVICE_KEY`), **but the keys remain in git
history and must be treated as compromised.**

**Manual action 1 — rotate keys** (Supabase Dashboard → Settings → API):
rotate the JWT secret (or migrate to `sb_secret_`/`sb_publishable_` keys). This
also invalidates the anon key → update it in
`src/integrations/supabase/config.ts` (or set `VITE_SUPABASE_ANON_KEY` in
`.env`) and redeploy. Also rotate the Semantic Scholar key.

**Manual action 2 — apply pending migrations** (`supabase db push`, needs DB
password; the CLI was returning 504s from this machine):
- `20260603_popularity_indexed_counters.sql` (perf, from previous session)
- `20260706_harden_function_search_path.sql` (NEW — pins `search_path` on
  `handle_new_user()` / `update_profiles_updated_at()`; both were flagged-style
  SECURITY DEFINER / mutable-search-path functions)

### Other changes in this pass
- **Secrets hygiene**: scripts now require `SUPABASE_SERVICE_KEY` env var (no
  fallback); `.env*` and `__pycache__/` added to `.gitignore`; `.env.example`
  added.
- **Supabase client config**: URL + anon key extracted to
  `src/integrations/supabase/config.ts`, read from `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` with production fallbacks; `client.ts` and
  `publicClient.ts` both import it.
- **Console log cleanup**: removed auth/session logging (`AuthContext.tsx`,
  `Index.tsx`) and product-fetch logging (`useIngredients.ts`); `FaceModel.tsx`
  debug logs now behind a dev-only `debug()` helper (console.warn kept).
- **Dependencies**: `npm audit fix` applied — 18 vulns → 1 (remaining: esbuild
  dev-server advisory, dev-only, fix requires breaking Vite 8 upgrade — deferred).
- **Hosting headers**: `firebase.json` now sets `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  and HSTS on all responses. (No CSP yet — needs testing against Spline/Supabase
  origins before adding.)

### Verified
✅ `npx tsc --noEmit` clean ✅ `npm run build` succeeds ✅ Python scripts compile

---

## ⭐ FEATURE: Default Ingredient Sort by Popularity (2026-06-01)

**Status**: ✅ **CODE COMPLETE — requires DB migration to be applied**

### Overview
The ingredient table now defaults to sorting by **popularity**, where popularity =
the number of times an ingredient is cited in users' liked products
(`product_favorites`), aggregated **globally across all users**.

### What Was Changed
- **`supabase/migrations/20260601_ingredient_popularity_ranking.sql`** (NEW):
  Creates view `sss_ingredients_ranked` = `sss_ingredients` + `like_count`
  (`COUNT(*)` of `product_favorites` rows joined through
  `sss_product_ingredients_join`). The view runs with default
  `security_invoker = false`, so it bypasses the per-user RLS on
  `product_favorites` and counts every user's likes. Only the aggregate count is
  exposed (no `user_id` / per-user data). `GRANT SELECT` to anon + authenticated
  so logged-out visitors also get global popularity.
- **`useIngredients.ts`**: queries `sss_ingredients_ranked` instead of
  `sss_ingredients`; default `sortBy` is now `'popularity'` (orders by
  `like_count desc`, then `product_count desc` as tiebreaker); maps `like_count`
  → `ProcessedIngredient.likeCount`.
- **`ingredientProcessor.ts`**: added `likeCount?: number`.
- **`types.ts`**: added `sss_ingredients_ranked` under `Views`.
- **`useIngredientFilters.ts`** + **`IngredientFilters.tsx`**: default `sortBy`
  changed `'name'` → `'popularity'`; added "Popularity" sort option.
- **`IngredientTable.tsx`**: shows a rose heart + count next to the product count
  when `likeCount > 0`.

### ⚠️ Action Required
Apply the migration before this works in production (otherwise the query 404s on
the missing view):
```bash
supabase db push
# or paste 20260601_ingredient_popularity_ranking.sql into the SQL editor
```

### Companion Feature
Product view popularity — see below.

---

## ⭐ FEATURE: Default Product Sort by Popularity (2026-06-02)

**Status**: ✅ **CODE COMPLETE — requires DB migration to be applied**

### Overview
The product list now defaults to sorting by **popularity** = total number of
times a product was liked across all users (`product_favorites`).

### What Was Changed
- **`supabase/migrations/20260602_product_popularity_ranking.sql`** (NEW):
  Creates view `sss_products_ranked` = `sss_products` + `like_count`
  (`COUNT(*)` of `product_favorites` grouped by `product_id`). Same RLS-bypass /
  aggregate-only / anon+authenticated `GRANT SELECT` design as
  `sss_ingredients_ranked`.
- **`useIngredients.ts`** (`useProducts`): fetches from `sss_products_ranked`,
  orders by `like_count desc` then `product_name asc`; maps rows into `Product`
  (now with `like_count?`). Product list paginates client-side as before, so
  popularity order is preserved across pages.
- **`types.ts`**: added `sss_products_ranked` under `Views`.
- **`ProductTable.tsx`**: shows a rose heart + count next to the ingredient
  count when `like_count > 0`.

### ⚠️ Action Required
```bash
supabase db push
# or paste 20260602_product_popularity_ranking.sql into the SQL editor
```

---

## ⚡ PERF: Indexed Popularity Counters (2026-06-03)

**Status**: ✅ **CODE COMPLETE — requires DB migration to be applied**

### Problem
The original `sss_*_ranked` views computed `like_count` with `COUNT(*)` +
`GROUP BY` + `LEFT JOIN` on **every** read, and `ORDER BY like_count` could not
use an index (computed per-query). Loading the full product list re-aggregated
all of `product_favorites` and full-sorted the whole table each request → noticeably slow.

### Fix
**`supabase/migrations/20260603_popularity_indexed_counters.sql`** (NEW):
- Adds real `like_count BIGINT` columns to `sss_products` and `sss_ingredients`.
- Indexes matching the app's ORDER BY: `sss_products (like_count DESC,
  product_name ASC)` and `sss_ingredients (like_count DESC, product_count DESC)`;
  plus `product_favorites (product_id)`.
- Backfills counts from current `product_favorites`.
- `sss_apply_favorite_counts()` trigger (AFTER INSERT/DELETE on
  `product_favorites`, `SECURITY DEFINER`) increments/decrements the affected
  product and its ingredients incrementally.
- Redefines `sss_ingredients_ranked` / `sss_products_ranked` as thin
  pass-throughs (same columns/order → **no frontend change**), so ordering is
  now index-backed.

### ⚠️ Action Required
```bash
supabase db push
# or paste 20260603_popularity_indexed_counters.sql into the SQL editor
```
Supersedes the per-query aggregation in the 20260601/20260602 views via
`CREATE OR REPLACE VIEW` (safe whether or not those were already applied).

---

## 🔄 MIGRATION: Switch to sss_ Tables Only (2025-11-25)

**Status**: ✅ **COMPLETED**

### Overview
Migrated all ingredient and product data to exclusively use Supabase tables starting with `sss_`. Removed all references to old tables (`ingredients_master`, `ingredients_cosing`, `ingredients_usfda`, `ingredient_references_master`).

### What Was Changed

#### 1. **useIngredients.ts** - Complete Rewrite
- Now fetches from `sss_ingredients` table instead of `ingredients_master` with joins
- Simplified data structure (no more USFDA/COSING specific fields)
- New fields: `productCount`, `avgPosition`
- Removed: CAS number, potency, max exposure, route, functions, restrictions

#### 2. **ingredientProcessor.ts** - Simplified
- Removed all legacy types (`MasterIngredient`, `USFDAData`, `COSINGData`, `JoinedIngredient`)
- Removed all processing functions (no longer needed)
- Kept only `ProcessedIngredient` interface with new fields

#### 3. **types.ts** - Removed Old Tables
Removed types for:
- `ingredients_master`
- `ingredients_cosing`
- `ingredients_usfda`
- `ingredient_references_master`

Kept:
- `profiles`, `ingredient_favorites`, `ingredient_history` (user features)
- `sss_ingredients`, `sss_products`, `sss_product_ingredients_join` (product data)

#### 4. **IngredientTable.tsx** - Updated UI
- Removed FDA/EU source badges
- Removed functions display
- Added product count and average position columns
- Removed IngredientPapers component

#### 5. **IngredientFilters.tsx** - New Filter Options
- Removed: "With CAS Number", "With Potency Data", "With Exposure Limits"
- Added: "In Products" filter
- New sort: "Product Count"

#### 6. **Removed Files**
- `src/hooks/useIngredientPapers.ts` - used non-sss table
- `src/components/IngredientPapers.tsx` - used non-sss table

### Current Data Model

```
sss_ingredients
├── ingredient_id (PK)
├── ingredient_name
├── product_count
└── avg_position

sss_products
├── product_id (PK)
├── product_name
└── ingredient_count

sss_product_ingredients_join
├── product_id (FK)
├── ingredient_id (FK)
└── position
```

### Verified
✅ TypeScript compilation successful
✅ Production build successful
✅ All old table references removed from src/

---

## 🛍️ FEATURE: Product-Ingredient Integration (2025-11-25)

**Status**: ✅ **FULLY IMPLEMENTED**

### Overview
Integrated three new Supabase tables (`sss_ingredients`, `sss_products`, `sss_product_ingredients_join`) to display products that contain each ingredient in the ingredient table.

### What Was Implemented

#### 1. **Database Types** (`src/integrations/supabase/types.ts`)
Added TypeScript types for three new tables:
- `sss_ingredients`: Ingredient master data (ingredient_id, ingredient_name, product_count, avg_position)
- `sss_products`: Product data (product_id, product_name, ingredient_count)
- `sss_product_ingredients_join`: Junction table linking products to ingredients (product_id, ingredient_id, position)

#### 2. **Data Fetching Hook** (`src/hooks/useIngredientProducts.ts`)
- `useIngredientProducts()`: Fetches all products containing a specific ingredient
- Joins `sss_product_ingredients_join` with `sss_products` to get full product info
- Returns products sorted by position in ingredient list
- Includes position (order in product ingredient list) and ingredient_count for context

#### 3. **UI Component** (`src/components/IngredientProducts.tsx`)
- Displays list of products containing an ingredient
- Shows product name, ingredient count, and position in ingredient list
- Styled with blue left border and hierarchical layout
- Includes loading state while fetching data
- Returns null gracefully if no products found

#### 4. **Integration into Ingredient Table** (`src/components/IngredientTable.tsx`)
- Added `IngredientProducts` component to expanded ingredient rows
- Shows product count and full product list in expandable row

### Features

✅ **Product Discovery** - See which products contain an ingredient
✅ **Position Tracking** - Shows where ingredient appears in product's ingredient list
✅ **Ingredient Count** - See how many total ingredients are in each product
✅ **Loading States** - Graceful loading indicator while fetching
✅ **Type Safe** - Full TypeScript support with proper types
✅ **Responsive Layout** - Clean hierarchical display with visual distinction

### Architecture

```
IngredientTable (main component)
├── IngredientRow (for each ingredient)
│   └── Expanded Detail View
│       └── IngredientProducts (products containing ingredient)
│           └── useIngredientProducts hook
│               └── Supabase join query

Database:
├── sss_ingredients (master ingredient data)
├── sss_products (product data)
└── sss_product_ingredients_join (linking table)
```

### Query Flow

1. User clicks expand on ingredient row
2. `IngredientProducts` component renders with ingredient.id
3. `useIngredientProducts` hook triggers query to Supabase
4. Query joins `sss_product_ingredients_join` + `sss_products` by ingredient_id
5. Results sorted by position (order in ingredient list)
6. Products displayed in expandable row with full details

### Verified

✅ TypeScript compilation successful (npx tsc --noEmit)
✅ Production build successful (npm run build)
✅ All types properly defined
✅ Hook follows existing React Query patterns

### Next Steps

- Test products display in development server (`npm run dev`)
- Verify Supabase queries return expected data
- Confirm join relationships work correctly
- Monitor performance with large product lists

---

## 🔐 FEATURE: User Authentication & Profiles (2025-11-18)

**Status**: ✅ **FULLY IMPLEMENTED - Ready for Supabase Setup**

### Overview
Implemented complete OAuth authentication system with Google and GitHub sign-in, user profiles, and ingredient preferences tracking.

### What Was Implemented

#### 1. **Database Schema** (`supabase/migrations/20251118_create_user_profiles.sql`)
- `profiles` table: User account information (email, name, avatar, skin type, concerns)
- `ingredient_favorites` table: Track user's favorite ingredients with personal notes
- `ingredient_history` table: Track viewed/searched ingredients for personalization
- Auto-creates user profiles on signup via database triggers
- Row-level security (RLS) policies for data privacy

#### 2. **TypeScript Types** (`src/integrations/supabase/types.ts`)
- Added `profiles`, `ingredient_favorites`, and `ingredient_history` table types
- Full type safety for database operations

#### 3. **Authentication Context** (`src/contexts/AuthContext.tsx`)
- `AuthProvider`: Wraps entire app, manages auth state
- `useAuth()` hook: Access session, user profile, and auth functions
- Functions: `signInWithGoogle()`, `signInWithGithub()`, `signOut()`, `updateProfile()`
- Auto-syncs auth state changes across app

#### 4. **Hooks for Data Management**
- `useIngredientFavorites()`: Add/remove favorites, check if ingredient is favorited
- `useIngredientHistory()`: Track ingredient views, clear history

#### 5. **UI Components**
- `AuthButton`: Sign in button / user menu in header
- `LoginDialog`: Modal with Google and GitHub OAuth buttons
- `UserMenu`: Dropdown menu with user info and navigation
- `IngredientFavoriteButton`: Heart icon to favorite ingredients from table

#### 6. **Pages**
- `/settings`: User profile management
  - Edit full name, bio, skin type, skin concerns
  - Auto-saves changes to database
  - Sign out option
- `/favorites`: View saved favorite ingredients
  - Lists all favorited ingredients
  - Remove from favorites
  - Shows date added

#### 7. **Route Protection**
- `ProtectedRoute`: Component for auth-required pages
- Automatically redirects unauthenticated users to home
- Added to `/settings` and `/favorites` routes

#### 8. **UI Components Created**
- `src/components/ui/textarea.tsx` - For bio/description text areas
- `src/components/ui/avatar.tsx` - For user profile pictures
- `src/components/ui/dropdown-menu.tsx` - For user menu

### Integration Into Index Page
- Added `AuthButton` to header (top-right corner)
- Shows "Sign In" button when logged out
- Shows user avatar when logged in
- Clicking menu provides access to Favorites, Settings, and Sign Out

### Features

✅ **OAuth with Google & GitHub** - No password management
✅ **Auto Profile Creation** - Profiles created automatically on signup
✅ **Ingredient Favorites** - Save/manage favorite ingredients
✅ **Ingredient History** - Track viewed ingredients (future: personalization)
✅ **User Settings** - Update profile, skin type, concerns
✅ **Route Protection** - Auth-only pages redirected if not logged in
✅ **Responsive Design** - Works on desktop and mobile
✅ **Type Safe** - Full TypeScript support

### Next Steps: Setting Up on Supabase

To activate this authentication system:

1. **Run the migration** in Supabase:
   ```bash
   # Option 1: Via CLI
   supabase db push

   # Option 2: Manual - Copy/paste the migration SQL to Supabase SQL Editor
   # File: supabase/migrations/20251118_create_user_profiles.sql
   ```

2. **Enable OAuth Providers**:
   - Go to Supabase Dashboard → Authentication → Providers
   - Enable "Google" and "GitHub"
   - Add OAuth app credentials from Google Cloud Console and GitHub
   - Set authorized redirect URI: `https://yourdomain.com`

3. **Test Login Flow**:
   - Visit home page, click "Sign In" button
   - Try Google login, then GitHub login
   - Check that profile is created in database
   - Verify settings and favorites pages work

### Architecture

```
AuthContext (wraps app)
├── Session & User State
├── OAuth Functions
└── Profile Update Function

Protected Pages
├── /settings - Edit profile & skin info
└── /favorites - Manage favorite ingredients

Database
├── profiles - User accounts & preferences
├── ingredient_favorites - Saved ingredients
└── ingredient_history - View tracking
```

### User Flow

1. **New User**: Click "Sign In" → OAuth provider → Auto profile created
2. **Returning User**: Click "Sign In" → OAuth provider → Resume session
3. **Personalization**: Settings page → Select skin type & concerns → Save
4. **Favorites**: Click heart on ingredient → Added to favorites → View on /favorites

### Code Quality
- ✅ TypeScript compilation successful
- ✅ All imports resolved
- ✅ Build completes without errors
- ✅ Production build ready (`npm run build`)

---

