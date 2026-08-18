// Skincare chatbot for Dermodel, grounded in the app's own Supabase data via
// Claude tool use. The model may ONLY state product/ingredient facts that come
// back from a tool call — it never invents ingredient lists.
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
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   (SUPABASE_URL and SUPABASE_ANON_KEY are auto-injected into edge functions;
//    the anon key is enough for the public sss_* reads, and the caller's own
//    Authorization header is forwarded for the RLS-protected favorites read.)

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Claude Haiku 4.5 — cheapest/fastest, good enough for grounded lookup + phrasing.
// Upgrade to "claude-sonnet-5" for harder multi-step reasoning if needed.
const MODEL = "claude-haiku-4-5";

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

const SYSTEM_PROMPT = `You are Dermodel's skincare assistant. You help people understand \
cosmetic ingredients and the products that contain them, using ONLY the Dermodel \
database exposed through your tools.

Rules:
- Answer questions about ingredients and products by calling the tools. Never invent \
or guess an ingredient list, a product's ingredients, or which products contain an \
ingredient — those facts must come from a tool result.
- If a tool returns no matching data, say plainly that you couldn't find it in the \
Dermodel database rather than making something up.
- Be concise and accurate. It's fine to explain what an ingredient generally does at a \
high level, but keep product/ingredient FACTS (names, ingredient lists, popularity) \
strictly to what the tools return.
- You are not a medical professional; do not give medical or dermatological diagnoses. \
Suggest consulting a professional for skin conditions.`;

// --- Supabase REST helpers -------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

// --- Tool definitions (sent to Claude) -------------------------------------

const tools = [
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

// --- Anthropic Messages API call -------------------------------------------

type AnthropicContentBlock = Record<string, unknown>;

async function callClaude(
  apiKey: string,
  messages: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Anthropic API error:", res.status, body);
    throw new Error(`Anthropic API failed (${res.status})`);
  }
  return await res.json();
}

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
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY is not set");
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

    // Normalize the incoming conversation to the Anthropic shape. We accept the
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
    const userToken = bearer && bearer !== SUPABASE_ANON_KEY ? bearer : null;

    // Tool-use loop: keep calling Claude, executing any tool calls, and feeding
    // results back until it produces a plain-text answer (or we hit the cap).
    let reply = "";
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const response = await callClaude(apiKey, messages);
      const contentBlocks = (response.content as AnthropicContentBlock[]) ?? [];

      // Collect any text the model produced this turn.
      const text = contentBlocks
        .filter((b) => b.type === "text")
        .map((b) => String(b.text ?? ""))
        .join("")
        .trim();

      if (response.stop_reason !== "tool_use") {
        reply = text;
        break;
      }

      // Append the assistant turn (with its tool_use blocks) verbatim.
      messages.push({ role: "assistant", content: contentBlocks });

      // Execute each requested tool and gather the results.
      const toolResults: AnthropicContentBlock[] = [];
      for (const block of contentBlocks) {
        if (block.type !== "tool_use") continue;
        const toolName = String(block.name ?? "");
        const toolInput = (block.input as Record<string, unknown>) ?? {};
        let resultContent: string;
        let isError = false;
        try {
          const result = await runTool(toolName, toolInput, userToken);
          resultContent = JSON.stringify(result);
        } catch (err) {
          console.error("Tool execution error:", toolName, err);
          resultContent = JSON.stringify({
            error: "Tool failed to run. Tell the user the lookup didn't work.",
          });
          isError = true;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultContent,
          is_error: isError,
        });
      }

      // Feed all tool results back in a single user turn and loop.
      messages.push({ role: "user", content: toolResults });

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

    return json({ reply });
  } catch (err) {
    console.error("chat function error:", err);
    return json({ error: "Something went wrong handling the chat request" }, 500);
  }
});
