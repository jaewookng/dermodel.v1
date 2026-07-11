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

---

This document outlines the steps to remove "Lovable" branding from your project and to enhance the 3D facial model's user interface for a more delightful experience.

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

