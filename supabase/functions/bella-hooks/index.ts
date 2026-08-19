// Bella's opening hooks — the clickbait one-liners she floats next to the face
// model before the user has said anything.
//
// DELIBERATELY ZERO LLM. Every hook is a fixed template with data slots filled
// by a few-hop traversal over our own tables. The LLM only enters the picture
// once the user clicks a hook, at which point the client sends the hook's
// `prompt` to the `chat` function. That keeps the "always-on, immediately
// helpful" surface free to run on every page load.
//
// Request:  POST {}            (Authorization header optional)
// Response: JSON { hooks: [{ id, text, prompt, kind }], personalized: boolean }
//
// Deploy: supabase functions deploy bella-hooks
// Secrets: none (SUPABASE_URL / SUPABASE_ANON_KEY are auto-injected)

import { getPublishableKey, isProjectApiKey } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = getPublishableKey();

const enc = encodeURIComponent;

interface Hook {
  id: string;
  /** The full clickbait line shown in the bubble on hover. */
  text: string;
  /** Two-or-three-word label for the chip row above the composer. */
  short: string;
  /** Loaded into the composer when the user picks this hook. */
  prompt: string;
  kind: "browse" | "personal";
}

// `authToken` is the bearer used for RLS: the anon key for public sss_* reads,
// or the forwarded caller JWT for the user's own favorites.
async function restGet(path: string, authToken: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Supabase REST error:", res.status, path, body);
    throw new Error(`Supabase query failed (${res.status})`);
  }
  return await res.json();
}

// Same as restGet but never throws — a hook that can't be built is simply
// dropped rather than taking the whole response down with it. This is also what
// lets the co-favorites hook degrade gracefully before its migration is applied.
async function tryGet(path: string, authToken: string): Promise<unknown[]> {
  try {
    return await restGet(path, authToken);
  } catch {
    return [];
  }
}

const pick = <T>(arr: T[]): T | null =>
  arr.length === 0 ? null : arr[Math.floor(Math.random() * arr.length)];

// Product names in this dataset are long ("Anua Heartleaf 80 Moisture Soothing
// Ampoule, 1.01 fl oz/30 mL"). Hooks live in a small floating bubble, so trim to
// the brand + first few words at a natural boundary.
function shortName(name: string): string {
  const base = name.split(/,|—| - /)[0].trim();
  const words = base.split(/\s+/);
  return words.length <= 6 ? base : words.slice(0, 6).join(" ");
}

// --- Hook templates --------------------------------------------------------
// The "arsenal". Each entry is a pure function of already-fetched data; the
// caller assembles whichever ones it has the data to fill.

const BROWSE_STATICS: Hook[] = [
  {
    id: "static-nighttime",
    text: "Looking for a new nighttime routine?",
    short: "Nighttime routine",
    prompt:
      "Help me build a nighttime skincare routine. What kinds of products should it include, and what's popular for each step?",
    kind: "browse",
  },
  {
    id: "static-safety",
    text: "Get a safety check before you put it on your skin ✨",
    short: "Safety check",
    prompt:
      "I want to check a product before I use it. Ask me which product, then walk me through what's in it and anything I should know about those ingredients.",
    kind: "browse",
  },
  {
    id: "static-cabinet",
    text: "Let's start building your skincare cabinet →",
    short: "Start a cabinet",
    prompt:
      "I'm starting from scratch. What are the essential product types for a basic skincare cabinet, and what are popular options for each?",
    kind: "browse",
  },
  {
    id: "static-favorites",
    text: "Heart your favorite products to get started!",
    short: "How favorites work",
    prompt:
      "How do favorites work here, and what will you be able to tell me once I've saved a few products?",
    kind: "browse",
  },
  {
    id: "static-sensitive",
    text: "Sensitive skin? Let's find what won't fight back.",
    short: "Sensitive skin",
    prompt:
      "I have sensitive skin. What ingredients should I look out for, and which popular products tend to be gentle?",
    kind: "browse",
  },
];

// --- Handler ---------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error("SUPABASE_URL / SUPABASE_ANON_KEY not available");
      return json({ error: "Server misconfigured" }, 500);
    }

    // Treat the anon key itself as "not a user", same as the chat function.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    // Not just the publishable key: mid-migration a client may still be
    // sending the legacy anon key, and mistaking that for a user JWT would
    // forward it as one.
    const userToken = bearer && !isProjectApiKey(bearer) ? bearer : null;

    const hooks: Hook[] = [];

    // ── Hop 0: does this user have saved products? ────────────────────────
    const favRows = userToken
      ? ((await tryGet(
        `product_favorites?select=product_id,created_at,sss_products(product_name)` +
          `&order=created_at.desc&limit=50`,
        userToken,
      )) as Array<Record<string, unknown>>)
      : [];

    const favorites = favRows
      .map((r) => {
        const p = r.sss_products as Record<string, unknown> | null;
        return {
          product_id: String(r.product_id ?? ""),
          product_name: p?.product_name ? String(p.product_name) : null,
        };
      })
      .filter((f) => f.product_id && f.product_name);

    const personalized = favorites.length > 0;

    if (personalized) {
      // ══ CASE 2: returning user with saved products ═════════════════════
      const favIds = new Set(favorites.map((f) => f.product_id));
      const seed = pick(favorites)!;
      const seedShort = shortName(seed.product_name!);

      // ── Hop 1: the seed product's ingredients ────────────────────────────
      const joinRows = (await tryGet(
        `sss_product_ingredients_join?product_id=eq.${enc(seed.product_id)}` +
          `&select=position,sss_ingredients(ingredient_id,ingredient_name,product_count,like_count)` +
          `&order=position.asc&limit=60`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;

      const seedIngredients = joinRows
        .map((r) => r.sss_ingredients as Record<string, unknown> | null)
        .filter((i): i is Record<string, unknown> => !!i)
        .map((i) => ({
          ingredient_id: String(i.ingredient_id ?? ""),
          ingredient_name: String(i.ingredient_name ?? ""),
          product_count: Number(i.product_count ?? 0),
          like_count: Number(i.like_count ?? 0),
        }))
        .filter((i) => i.ingredient_id && i.ingredient_name);

      // Pick a *characterful* ingredient, not water/glycerin: something that
      // appears in enough products to have neighbours but is not universal.
      const distinctive = seedIngredients
        .filter((i) => i.product_count >= 15 && i.product_count <= 4000)
        .sort((a, b) =>
          b.like_count - a.like_count || a.product_count - b.product_count
        )[0] ??
        seedIngredients.sort((a, b) => a.product_count - b.product_count)[0] ??
        null;

      if (distinctive) {
        // ── Hop 2: other products built on that same ingredient ───────────
        const neighbourRows = (await tryGet(
          `sss_product_ingredients_join?ingredient_id=eq.${
            enc(distinctive.ingredient_id)
          }` +
            `&select=sss_products(product_id,product_name,like_count)` +
            `&order=sss_products(like_count).desc.nullslast&limit=60`,
          SUPABASE_ANON_KEY,
        )) as Array<Record<string, unknown>>;

        const neighbours = neighbourRows
          .map((r) => r.sss_products as Record<string, unknown> | null)
          .filter((p): p is Record<string, unknown> => !!p)
          .map((p) => ({
            product_id: String(p.product_id ?? ""),
            product_name: String(p.product_name ?? ""),
          }))
          .filter((p) => p.product_id && p.product_name && !favIds.has(p.product_id));

        if (neighbours.length >= 3) {
          hooks.push({
            id: "personal-pairs-with",
            short: "Pairs with saved",
            text: `I found ${neighbours.length} new products that would go well with ${seedShort}`,
            prompt:
              `I've saved ${seed.product_name}. What other products in the Dermodel database share its key ingredients and would go well with it?`,
            kind: "personal",
          });
        }

        // ── Hop 3: the paraben-free cut of those neighbours ───────────────
        if (neighbours.length > 0) {
          const parabenRows = (await tryGet(
            `sss_ingredients?ingredient_name=ilike.*paraben*&select=ingredient_id&limit=60`,
            SUPABASE_ANON_KEY,
          )) as Array<Record<string, unknown>>;
          const parabenIds = parabenRows
            .map((r) => String(r.ingredient_id ?? ""))
            .filter(Boolean);

          if (parabenIds.length > 0) {
            const candidateIds = neighbours.slice(0, 25).map((n) => n.product_id);
            const flaggedRows = (await tryGet(
              `sss_product_ingredients_join?product_id=in.(${
                candidateIds.map(enc).join(",")
              })` +
                `&ingredient_id=in.(${parabenIds.map(enc).join(",")})` +
                `&select=product_id&limit=200`,
              SUPABASE_ANON_KEY,
            )) as Array<Record<string, unknown>>;
            const flagged = new Set(
              flaggedRows.map((r) => String(r.product_id ?? "")),
            );

            const clean = neighbours
              .slice(0, 25)
              .filter((n) => !flagged.has(n.product_id));

            const cleanPick = pick(clean);
            if (cleanPick) {
              hooks.push({
                id: "personal-paraben-free",
            short: "Paraben free",
                text: `${
                  shortName(cleanPick.product_name)
                } is like ${seedShort} — and it's paraben free`,
                prompt:
                  `Tell me about ${cleanPick.product_name}. How does it compare to ${seed.product_name}, which I've saved, and confirm whether it's paraben free?`,
                kind: "personal",
              });
            }
          }
        }
      }

      // ── Hop 2': what other people who saved this also saved ──────────────
      // Degrades silently to nothing if 20260819_co_favorites.sql isn't applied.
      const coRows = (await tryGet(
        `sss_co_favorites?product_id=eq.${enc(seed.product_id)}` +
          `&select=also_product_id,co_count&order=co_count.desc&limit=10`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;

      const coIds = coRows
        .map((r) => String(r.also_product_id ?? ""))
        .filter((id) => id && !favIds.has(id));

      if (coIds.length > 0) {
        const coProducts = (await tryGet(
          `sss_products?product_id=in.(${coIds.slice(0, 5).map(enc).join(",")})` +
            `&select=product_id,product_name&limit=5`,
          SUPABASE_ANON_KEY,
        )) as Array<Record<string, unknown>>;
        const coPick = pick(coProducts);
        if (coPick?.product_name) {
          hooks.push({
            id: "personal-co-favorite",
            short: "Others also liked",
            text: `People who saved ${seedShort} also liked ${
              shortName(String(coPick.product_name))
            }`,
            prompt:
              `Other people who saved ${seed.product_name} also saved ${coPick.product_name}. What do those two have in common, and what's in the second one?`,
            kind: "personal",
          });
        }
      }

      // Always-available personal fallbacks so there's never an empty bubble.
      hooks.push({
        id: "personal-routine-check",
        text: `Want me to check your saved products for overlaps?`,
        short: "Check overlaps",
        prompt:
          "Look at my saved products and tell me which ingredients repeat across them, and whether anything in there is redundant or worth not layering together.",
        kind: "personal",
      });
      hooks.push({
        id: "personal-whats-missing",
        text: "Here's what's missing from your cabinet",
        short: "What's missing",
        prompt:
          "Based on my saved products, what kind of product am I missing from a complete routine?",
        kind: "personal",
      });
    } else {
      // ══ CASE 1: new user, just browsing ════════════════════════════════
      const hotProducts = (await tryGet(
        `sss_products?select=product_id,product_name,like_count` +
          `&order=like_count.desc.nullslast&limit=5`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;

      const hot = hotProducts.filter((p) => Number(p.like_count ?? 0) > 0);
      const hotPick = pick(hot);
      if (hotPick?.product_name) {
        hooks.push({
          id: "browse-hot-product",
            short: "What's hot",
          text: `Here's what's hot: ${shortName(String(hotPick.product_name))} \u{1F525}`,
          prompt:
            `What's in ${hotPick.product_name}, and why do you think people are saving it?`,
          kind: "browse",
        });
        hooks.push({
          id: "browse-others-using",
            short: "Most saved",
          text: "See what everyone else is using →",
          prompt:
            "What are the most-saved products on Dermodel right now, and what do they have in common?",
          kind: "browse",
        });
      }

      const hotIngredients = (await tryGet(
        `sss_ingredients?select=ingredient_name,like_count,product_count` +
          `&order=like_count.desc.nullslast&limit=5`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;
      const ingPick = pick(hotIngredients.filter((i) => i.ingredient_name));
      if (ingPick) {
        hooks.push({
          id: "browse-hot-ingredient",
            short: "Trending ingredient",
          text: `${
            String(ingPick.ingredient_name)
          } is everywhere right now — want to know why?`,
          prompt:
            `Tell me about ${ingPick.ingredient_name} — what it does, and which popular products use it.`,
          kind: "browse",
        });
      }

      hooks.push(...BROWSE_STATICS);
    }

    // Shuffle so repeat visitors don't see the same opener every time, but keep
    // the data-backed hooks (pushed first) biased toward the front.
    const head = hooks.slice(0, 3).sort(() => Math.random() - 0.5);
    const tail = hooks.slice(3).sort(() => Math.random() - 0.5);

    return json({ hooks: [...head, ...tail].slice(0, 8), personalized });
  } catch (err) {
    console.error("bella-hooks function error:", err);
    return json({ error: "Could not build hooks" }, 500);
  }
});
