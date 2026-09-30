// Skincare chatbot for Dermodel, grounded in the app's own Supabase data via
// LLM tool use (DeepSeek, served through OpenRouter). The model may ONLY state
// product/ingredient facts that come back from a tool call — it never invents
// ingredient lists.
//
// Request:  POST { messages: [{ role: "user" | "assistant", content: string }] }
// Response: JSON { reply: string }   (non-streaming — see note below)
//
// We return a single clean JSON { reply } rather than streaming: the tool-use
// loop (tool_use -> execute -> tool_result -> repeat) is far simpler to run to
// completion server-side and hand back one final answer. Streaming can be added
// later by switching the final assistant turn to SSE.
//
// Deploy:  supabase functions deploy chat
// Secret:  supabase secrets set OPENROUTER_API_KEY=sk-or-...
//   Optional: CHAT_MODEL=<openrouter model id> overrides DEFAULT_MODEL without a
//   code change (e.g. deepseek/deepseek-v4-pro for harder reasoning).
//   (SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected into edge functions;
//    the anon key is enough for the public sss_* reads, and the caller's own
//    Authorization header is forwarded for the RLS-protected favorites read.)

import { getPublishableKey, getSecretKey, isProjectApiKey } from "../_shared/keys.ts";

// OpenRouter exposes an OpenAI-compatible chat-completions API, so the request
// and tool-call shapes below are OpenAI's, not Anthropic's.
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// DeepSeek V4 Flash — cheap and fast, supports tool calling; good enough for
// grounded lookup + phrasing. Use the undated alias so OpenRouter keeps it
// pointed at the current Flash build.
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const MODEL = Deno.env.get("CHAT_MODEL")?.trim() || DEFAULT_MODEL;

const MAX_TOOL_ITERATIONS = 5;

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

// ── Bella's guidelines ──────────────────────────────────────────────────────
// This is the ONLY place Bella's voice and rules are defined. Edit here and
// redeploy (`supabase functions deploy chat`). The cabinet block is appended
// per request by buildSystemPrompt() below.
const SYSTEM_PROMPT = `You are Bella, Dermodel's skincare assistant. You help people understand \
cosmetic ingredients and the products that contain them, using ONLY the Dermodel \
database exposed through your tools.

Who you are talking to:
The person is already curious and literate enough to seek out ingredient lists. They \
are not a beginner and do not want to be talked down to, but they are not a chemist \
either. Treat them as a sharp non-specialist.

How to communicate (science communication rules):
- Each answer should carry ONE or TWO genuine technical terms that are relevant to the \
question — the concept that actually explains the answer (e.g. "humectant", \
"chelating agent", "pKa", "occlusive", "comedogenic", "emulsifier", "penetration \
enhancer", "free-radical scavenger"). Ingredient names and INCI names do NOT count \
toward this — use them freely, they are just labels.
- Introduce each technical term once, in passing, with a short plain-language gloss \
right where it appears (e.g. "a humectant — something that pulls water into the \
skin"). Then use the term normally for the rest of the answer.
- Everything AROUND those terms must be simplified: short sentences, concrete \
mechanisms, no stacked jargon. If a sentence needs a third technical term to work, \
rewrite it in plain words instead.
- The reader should come away feeling slightly stretched — they were handed a concept \
just beyond what they already knew, and they understood it. Aim for that, not for \
comfort and not for a lecture.
- Prefer explaining the mechanism ("why") over listing attributes ("what"). One clear \
mechanism beats three vague benefits.
- Be concise. No preamble, no recap of the question, no closing offer.

Their cabinet (what they use every day):
- If a "User's cabinet" section is present below, that is the list of products this \
person currently uses, with when in the day they use each. It is already loaded — \
you do not need to ask for it.
- For ANY product- or ingredient-specific question, look through that cabinet first \
and answer in the context of what they already use: does something in their routine \
already contain this ingredient, does it clash or overlap with what they use at that \
time of day, would this product duplicate something they own. Say so explicitly \
("You already get niacinamide in the morning from your Anua ampoule").
- To check what a cabinet product actually contains, call get_product with its \
product_id. Never guess a cabinet product's ingredient list.
- If there is no cabinet section, the person is signed out or has no cabinet; answer \
normally and do not mention the cabinet unless they ask.

Facts and honesty:
- Answer questions about ingredients and products by calling the tools. Never invent \
or guess an ingredient list, a product's ingredients, or which products contain an \
ingredient — those facts must come from a tool result.
- If a tool returns no matching data, say plainly that you couldn't find it in the \
Dermodel database rather than making something up.
- It's fine to explain what an ingredient generally does, but keep product/ingredient \
FACTS (names, ingredient lists, popularity) strictly to what the tools return.
- You are not a medical professional; do not give medical or dermatological diagnoses. \
Suggest consulting a professional for skin conditions.`;

// --- Supabase REST helpers -------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = getPublishableKey();

// Query PostgREST. `authToken` is the bearer used for RLS — the anon key for
// public sss_* reads, or the forwarded caller JWT for favorites.
async function restGet(
  path: string,
  authToken: string,
): Promise<unknown[]> {
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

const enc = encodeURIComponent;

// --- Cabinet context (pre-loaded, not a tool) ------------------------------
// Bella should "natively" know what the user uses daily, so the cabinet is read
// once per request and appended to the system prompt rather than left to the
// model to ask for. Reads `my_cabinet` (20260823) with the caller's JWT, so RLS
// scopes it. Any failure — signed out, view not yet applied, network — yields
// null and the prompt simply has no cabinet section.
type CabinetRow = {
  product_id: unknown;
  product_name: unknown;
  routine: unknown;
  frequency: unknown;
  days_supply: unknown;
  estimated_empty_on: unknown;
  status: unknown;
};

const MAX_CABINET_ITEMS = 40;

function describeRoutine(routine: unknown): string {
  switch (routine) {
    case "am": return "morning";
    case "pm": return "evening";
    case "both": return "morning and evening";
    default: return "unspecified time";
  }
}

function describeFrequency(freq: unknown): string {
  switch (freq) {
    case "daily": return "daily";
    case "every_other_day": return "every other day";
    case "weekly": return "weekly";
    case "as_needed": return "as needed";
    default: return typeof freq === "string" ? freq.replace(/_/g, " ") : "";
  }
}

async function fetchCabinetContext(userToken: string | null): Promise<string | null> {
  if (!userToken) return null;
  try {
    const rows = (await restGet(
      `my_cabinet?select=product_id,product_name,routine,frequency,days_supply,estimated_empty_on,status` +
        `&order=opened_on.desc&limit=${MAX_CABINET_ITEMS}`,
      userToken,
    )) as CabinetRow[];
    const active = rows.filter((r) => r.status == null || r.status === "active");
    if (active.length === 0) return null;
    const lines = active.map((r) => {
      const bits = [describeRoutine(r.routine), describeFrequency(r.frequency)].filter(Boolean);
      const left = typeof r.days_supply === "number"
        ? `, roughly ${Math.round(Number(r.days_supply))} days of supply`
        : "";
      return `- ${String(r.product_name)} (product_id ${String(r.product_id)}) — ${bits.join(", ")}${left}`;
    });
    return `User's cabinet (${active.length} product${active.length === 1 ? "" : "s"} they currently use):\n${lines.join("\n")}`;
  } catch (err) {
    // Not fatal: the view may not be applied yet, or the token may be stale.
    console.warn("cabinet context unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

function buildSystemPrompt(cabinet: string | null): string {
  return cabinet ? `${SYSTEM_PROMPT}\n\n${cabinet}` : SYSTEM_PROMPT;
}

// --- Tool definitions (sent to the model) ----------------------------------

const toolSpecs = [
  {
    name: "search_ingredients",
    description:
      "Search the Dermodel ingredient database by name. Returns matching ingredients ordered by popularity (like_count) then how many products use them. Call this when the user asks about an ingredient or wants to find ingredients by a partial name.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Full or partial ingredient name, e.g. 'niacinamide'.",
        },
        limit: {
          type: "integer",
          description: "Max results to return (default 10).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description:
      "Look up a single product by name (or exact product id) and return the product plus its full ingredient list in order of appearance. Call this when the user names a specific product or asks what's in a product.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Product name (partial ok) or exact product id.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_products_containing",
    description:
      "Given an ingredient name, list products whose ingredient list includes that ingredient, ordered by product popularity (like_count). Call this when the user asks which products contain an ingredient.",
    input_schema: {
      type: "object",
      properties: {
        ingredient_name: {
          type: "string",
          description: "The ingredient to search for, e.g. 'retinol'.",
        },
        limit: {
          type: "integer",
          description: "Max products to return (default 15).",
        },
      },
      required: ["ingredient_name"],
    },
  },
  {
    name: "get_user_favorites",
    description:
      "Return the products the current signed-in user has favorited. Only works when the request is authenticated; otherwise returns an empty list. Call this when the user refers to their own saved/liked/favorite products.",
    input_schema: { type: "object", properties: {} },
  },
];

// OpenAI function-tool shape.
const tools = toolSpecs.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// --- Tool handlers ---------------------------------------------------------

// `userToken` is the caller's forwarded JWT (or null if unauthenticated).
async function runTool(
  name: string,
  input: Record<string, unknown>,
  userToken: string | null,
): Promise<unknown> {
  switch (name) {
    case "search_ingredients": {
      const query = String(input.query ?? "").trim();
      if (!query) return { ingredients: [] };
      const limit = clampLimit(input.limit, 10, 25);
      const rows = await restGet(
        `sss_ingredients?ingredient_name=ilike.*${enc(query)}*` +
          `&select=ingredient_id,ingredient_name,product_count,like_count` +
          `&order=like_count.desc.nullslast,product_count.desc.nullslast` +
          `&limit=${limit}`,
        SUPABASE_ANON_KEY,
      );
      return { ingredients: rows };
    }

    case "get_product": {
      const query = String(input.query ?? "").trim();
      if (!query) return { found: false };
      // Try exact id first, then name ilike.
      let products = (await restGet(
        `sss_products?product_id=eq.${enc(query)}` +
          `&select=product_id,product_name,ingredient_count,like_count,image_url,image_source_url` +
          `&limit=1`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;
      if (products.length === 0) {
        products = (await restGet(
          `sss_products?product_name=ilike.*${enc(query)}*` +
            `&select=product_id,product_name,ingredient_count,like_count,image_url,image_source_url` +
            `&order=like_count.desc.nullslast&limit=1`,
          SUPABASE_ANON_KEY,
        )) as Array<Record<string, unknown>>;
      }
      if (products.length === 0) return { found: false };
      const product = products[0];
      const joinRows = (await restGet(
        `sss_product_ingredients_join?product_id=eq.${enc(String(product.product_id))}` +
          `&select=position,sss_ingredients(ingredient_name)` +
          `&order=position.asc`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;
      const ingredients = joinRows.map((r) => {
        const ing = r.sss_ingredients as Record<string, unknown> | null;
        return {
          position: r.position,
          ingredient_name: ing?.ingredient_name ?? null,
        };
      });
      return { found: true, product, ingredients };
    }

    case "list_products_containing": {
      const ingredientName = String(input.ingredient_name ?? "").trim();
      if (!ingredientName) return { products: [] };
      const limit = clampLimit(input.limit, 15, 30);
      // Resolve the best-matching ingredient id first.
      const ingRows = (await restGet(
        `sss_ingredients?ingredient_name=ilike.*${enc(ingredientName)}*` +
          `&select=ingredient_id,ingredient_name&order=product_count.desc.nullslast&limit=1`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;
      if (ingRows.length === 0) {
        return { products: [], note: "No matching ingredient found." };
      }
      const ingredient = ingRows[0];
      const joinRows = (await restGet(
        `sss_product_ingredients_join?ingredient_id=eq.${enc(String(ingredient.ingredient_id))}` +
          `&select=position,sss_products(product_id,product_name,like_count,image_url)` +
          `&order=sss_products(like_count).desc.nullslast&limit=${limit}`,
        SUPABASE_ANON_KEY,
      )) as Array<Record<string, unknown>>;
      const products = joinRows
        .map((r) => {
          const p = r.sss_products as Record<string, unknown> | null;
          if (!p) return null;
          return {
            product_id: p.product_id,
            product_name: p.product_name,
            like_count: p.like_count,
            position: r.position,
          };
        })
        .filter((p) => p !== null);
      return {
        matched_ingredient: ingredient.ingredient_name,
        products,
      };
    }

    case "get_user_favorites": {
      if (!userToken) {
        return {
          favorites: [],
          note: "The user is not signed in, so no favorites are available.",
        };
      }
      // Read with the caller's JWT so RLS returns only their own rows.
      const rows = (await restGet(
        `product_favorites?select=product_id,created_at,sss_products(product_name,like_count,image_url)` +
          `&order=created_at.desc`,
        userToken,
      )) as Array<Record<string, unknown>>;
      const favorites = rows.map((r) => {
        const p = r.sss_products as Record<string, unknown> | null;
        return {
          product_id: r.product_id,
          product_name: p?.product_name ?? null,
          like_count: p?.like_count ?? null,
        };
      });
      return { favorites };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// --- OpenRouter chat-completions call --------------------------------------

type ChatMessage = Record<string, unknown>;

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

async function callModel(
  apiKey: string,
  system: string,
  messages: ChatMessage[],
): Promise<Record<string, unknown>> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional OpenRouter attribution headers (shown in their dashboard).
      "HTTP-Referer": Deno.env.get("APP_ORIGIN") ?? "https://dermodel.app",
      "X-Title": "Dermodel",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "system", content: system }, ...messages],
      tools,
      provider: {
        // Only route to providers that actually support every parameter we
        // send (i.e. tools) — otherwise OpenRouter may pick one that silently
        // drops them and the model answers ungrounded.
        require_parameters: true,
        // Skip providers that retain or train on prompts; these are users'
        // skincare questions.
        data_collection: "deny",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("OpenRouter API error:", res.status, body);
    throw new Error(`OpenRouter API failed (${res.status})`);
  }
  const body = await res.json();
  // OpenRouter can return 200 with an error object (e.g. upstream failure).
  if (body?.error) {
    console.error("OpenRouter upstream error:", JSON.stringify(body.error));
    throw new Error("OpenRouter upstream error");
  }
  return body;
}

// --- Handler ---------------------------------------------------------------


// ── Billing gate ────────────────────────────────────────────────────────────
// Every turn must be authorised BEFORE we spend money at the model provider. The gate
// lives in `consume_chat_turn()` (20260824), which owns the plan lookup, the
// lifetime/monthly conversation counters, the per-conversation turn cap and the
// credit ledger — so this function never re-implements any of that policy.
//
// Anonymous callers have no user id, so they are counted against a salted hash
// of their publishable key + client fingerprint. This is deliberately weak: an
// anon user who clears state gets a fresh allowance, which is why the anon
// allowance is small. Signed-in users are counted durably.

const CHAT_ANON_SALT = Deno.env.get("CHAT_ANON_SALT") ?? "";

async function anonKeyHash(req: Request): Promise<string> {
  // Not a security control -- just a stable-ish bucket for rate limiting.
  const fingerprint = [
    req.headers.get("x-client-info") ?? "",
    req.headers.get("user-agent") ?? "",
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
  ].join("|");
  const data = new TextEncoder().encode(`${CHAT_ANON_SALT}:${fingerprint}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface GateResult {
  allowed: boolean;
  plan: string | null;
  conversation_id: string | null;
  conversation_started: boolean;
  turns_remaining_in_conversation: number | null;
  conversations_remaining: number | null;
  conversations_remaining_lifetime: number | null;
  credits_remaining: number | null;
  credit_usd_remaining: number | null;
  reason: string | null;
  usage_event_id: string | null;
}

/** Resolves the caller's user id from their JWT, or null when anonymous. */
async function resolveUserId(userToken: string | null): Promise<string | null> {
  if (!userToken) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: getPublishableKey(),
        Authorization: `Bearer ${userToken}`,
      },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.id === "string" ? body.id : null;
  } catch {
    return null;
  }
}

async function consumeTurn(
  userId: string | null,
  anonHash: string | null,
  conversationId: string | null,
): Promise<GateResult | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_chat_turn`, {
    method: "POST",
    headers: {
      apikey: getSecretKey(),
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_anon_key_hash: userId ? null : anonHash,
      p_conversation_id: conversationId,
      p_model: MODEL,
      p_deep_dive: false,
    }),
  });
  if (!res.ok) {
    console.error("consume_chat_turn failed:", res.status, await res.text());
    return null;
  }
  const rows = await res.json();
  return Array.isArray(rows) ? (rows[0] ?? null) : rows;
}

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
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      console.error("OPENROUTER_API_KEY is not set");
      return json({ error: "Chat is not configured" }, 500);
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error("SUPABASE_URL / SUPABASE_ANON_KEY not available");
      return json({ error: "Server misconfigured" }, 500);
    }

    const body = await req.json().catch(() => null);
    const incoming = body?.messages;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return json({ error: "Request must include a non-empty messages array" }, 400);
    }

    // Normalize the incoming conversation to the chat-completions shape. We accept the
    // simple { role, content: string } form the client sends and keep only
    // user/assistant turns with string content.
    const messages: Array<Record<string, unknown>> = [];
    for (const m of incoming) {
      const role = m?.role;
      const content = m?.content;
      if (
        (role === "user" || role === "assistant") &&
        typeof content === "string" &&
        content.trim()
      ) {
        messages.push({ role, content });
      }
    }
    if (messages.length === 0) {
      return json({ error: "No valid user/assistant messages provided" }, 400);
    }

    // Forward the caller's JWT for the RLS-scoped favorites lookup. The client
    // sends `Authorization: Bearer <supabase access token>`; we treat the anon
    // key itself as "not a user" so favorites stays empty for anon callers.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    // Not just the publishable key: mid-migration a client may still be
    // sending the legacy anon key, and mistaking that for a user JWT would
    // forward it as one.
    const userToken = bearer && !isProjectApiKey(bearer) ? bearer : null;

    // ── Authorise this turn before spending anything at the provider ───────
    const rawConversationId = body?.conversation_id;
    const conversationId = typeof rawConversationId === "string" && rawConversationId
      ? rawConversationId
      : null;

    const userId = await resolveUserId(userToken);
    const anonHash = userId ? null : await anonKeyHash(req);
    const gate = await consumeTurn(userId, anonHash, conversationId);

    if (!gate) {
      // The gate itself failed. Fail CLOSED: an unmetered answer costs real
      // money and silently breaks the allowance model.
      return json({ error: "Chat is temporarily unavailable" }, 503);
    }

    if (!gate.allowed) {
      // 402 with the full body, so the client can render the wall without a
      // second fetch (docs/payment-model.md §12.5).
      return json({
        error: "limit_reached",
        reason: gate.reason ?? "chat_not_available",
        plan: gate.plan,
        conversation_id: gate.conversation_id,
        conversations_remaining_lifetime: gate.conversations_remaining_lifetime,
        conversations_remaining: gate.conversations_remaining,
        credit_usd_remaining: gate.credit_usd_remaining ?? 0,
      }, 402);
    }

    // Tool-use loop: keep calling the model, executing any tool calls, and feeding
    // results back until it produces a plain-text answer (or we hit the cap).
    // Load the cabinet AFTER the gate (no DB read for a refused turn) and
    // BEFORE the first model call, so Bella sees it on turn one.
    const systemPrompt = buildSystemPrompt(await fetchCabinetContext(userToken));

    let reply = "";
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const response = await callModel(apiKey, systemPrompt, messages);
      const choice = (response.choices as Array<Record<string, unknown>>)?.[0];
      const message = (choice?.message as Record<string, unknown>) ?? {};
      const text = typeof message.content === "string"
        ? message.content.trim()
        : "";
      const toolCalls = (message.tool_calls as ToolCall[] | undefined) ?? [];

      // Some providers report finish_reason "stop" alongside tool calls, so
      // key off the presence of tool_calls rather than finish_reason alone.
      if (toolCalls.length === 0) {
        reply = text;
        break;
      }

      // Append the assistant turn (with its tool_calls) verbatim.
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls,
      });

      // Execute each requested tool; every tool_call id needs a reply.
      for (const call of toolCalls) {
        const toolName = String(call.function?.name ?? "");
        let resultContent: string;
        try {
          // Arguments arrive as a JSON string and may be empty or malformed.
          const rawArgs = call.function?.arguments;
          const toolInput = rawArgs ? JSON.parse(rawArgs) : {};
          const result = await runTool(
            toolName,
            toolInput && typeof toolInput === "object" ? toolInput : {},
            userToken,
          );
          resultContent = JSON.stringify(result);
        } catch (err) {
          console.error("Tool execution error:", toolName, err);
          resultContent = JSON.stringify({
            error: "Tool failed to run. Tell the user the lookup didn't work.",
          });
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultContent,
        });
      }

      // If we're about to exceed the iteration cap, fall back to any text.
      if (iter === MAX_TOOL_ITERATIONS - 1) {
        reply = text ||
          "I wasn't able to finish looking that up. Could you rephrase or narrow the question?";
      }
    }

    if (!reply) {
      reply =
        "Sorry, I couldn't come up with an answer. Could you try rephrasing your question?";
    }

    return json({
      reply,
      conversation_id: gate.conversation_id,
      turns_remaining_in_conversation: gate.turns_remaining_in_conversation,
      conversations_remaining_lifetime: gate.conversations_remaining_lifetime,
      conversations_remaining: gate.conversations_remaining,
      credit_usd_remaining: gate.credit_usd_remaining ?? 0,
    });
  } catch (err) {
    console.error("chat function error:", err);
    return json({ error: "Something went wrong handling the chat request" }, 500);
  }
});
