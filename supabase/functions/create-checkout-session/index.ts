// Creates a Stripe-hosted session for the signed-in caller: either a Checkout
// session (start/upgrade a subscription, or buy a credit top-up) or a Billing
// Portal session (manage payment method, cancel, view invoices).
//
// Request:  POST { mode: "subscription" | "payment" | "portal",
//                  plan?: "plus", interval?: "monthly" | "yearly",
//                  return_url?: string }
// Response: JSON { url: string }   -- redirect the browser to it
//
// Auth: REQUIRED. The caller's `Authorization: Bearer <supabase access token>`
// is verified server-side; the Stripe customer is keyed off that user id, never
// off anything in the request body.
//
// Deploy:  supabase functions deploy create-checkout-session
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.)

const STRIPE_API = "https://api.stripe.com/v1";

// Where to send the user back to when they finish or abandon the flow. Only
// URLs on this origin are accepted as `return_url` (open-redirect guard).
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://dermodel.app";

// Price for the one-time credit top-up pack (100 credits). Optional -- the
// "payment" mode is rejected when it isn't configured.
const TOPUP_PRICE_ID = Deno.env.get("STRIPE_TOPUP_PRICE_ID") ?? "";
const TOPUP_CREDITS = 100;

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
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// --- Stripe REST helper -----------------------------------------------------
// Stripe's API is form-encoded, including nested keys like
// `subscription_data[metadata][user_id]`.

function formEncode(
  params: Record<string, unknown>,
  prefix = "",
): string[][] {
  const pairs: string[][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      pairs.push(...formEncode(value as Record<string, unknown>, name));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          pairs.push(
            ...formEncode(item as Record<string, unknown>, `${name}[${i}]`),
          );
        } else {
          pairs.push([`${name}[${i}]`, String(item)]);
        }
      });
    } else {
      pairs.push([name, String(value)]);
    }
  }
  return pairs;
}

async function stripe(
  apiKey: string,
  path: string,
  params?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${STRIPE_API}/${path}`, {
    method: params ? "POST" : "GET",
    headers,
    body: params
      ? new URLSearchParams(formEncode(params)).toString()
      : undefined,
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("Stripe API error:", res.status, path, JSON.stringify(body));
    throw new Error(`Stripe request failed (${res.status})`);
  }
  return body as Record<string, unknown>;
}

// --- Supabase REST helpers --------------------------------------------------

async function rest(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Supabase REST error:", res.status, path, body);
    throw new Error(`Supabase query failed (${res.status})`);
  }
  return res.status === 204 ? null : await res.json();
}

// Verify the caller's access token and return their user id + email.
async function resolveUser(
  token: string,
): Promise<{ id: string; email: string | null } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as Record<string, unknown>;
  const id = typeof user.id === "string" ? user.id : null;
  if (!id) return null;
  return { id, email: typeof user.email === "string" ? user.email : null };
}

// Look up (or lazily create) the caller's Stripe customer.
async function getOrCreateCustomer(
  apiKey: string,
  userId: string,
  email: string | null,
): Promise<string> {
  const rows = (await rest(
    `billing_customers?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=stripe_customer_id&limit=1`,
  )) as Array<Record<string, unknown>>;
  if (rows.length > 0 && typeof rows[0].stripe_customer_id === "string") {
    return rows[0].stripe_customer_id;
  }

  const customer = await stripe(
    apiKey,
    "customers",
    {
      email: email ?? undefined,
      metadata: { user_id: userId },
    },
    // Idempotent on the user id: a double-click can't create two customers.
    `dermodel-customer-${userId}`,
  );
  const customerId = String(customer.id);

  await rest("billing_customers", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: userId, stripe_customer_id: customerId }),
  });

  return customerId;
}

// Resolve the Stripe price id for a plan + interval from billing_plans, so
// price changes are a DB update rather than a redeploy.
async function priceIdForPlan(
  plan: string,
  interval: "monthly" | "yearly",
): Promise<string | null> {
  const column =
    interval === "yearly" ? "stripe_price_id_yearly" : "stripe_price_id_monthly";
  const rows = (await rest(
    `billing_plans?plan=eq.${encodeURIComponent(plan)}&select=${column}&limit=1`,
  )) as Array<Record<string, unknown>>;
  const value = rows[0]?.[column];
  return typeof value === "string" && value ? value : null;
}

function safeReturnUrl(raw: unknown, fallbackPath: string): string {
  if (typeof raw === "string" && raw) {
    try {
      const url = new URL(raw, APP_ORIGIN);
      if (url.origin === new URL(APP_ORIGIN).origin) return url.toString();
    } catch {
      // fall through to the default
    }
  }
  return `${APP_ORIGIN}${fallbackPath}`;
}

// --- Handler ----------------------------------------------------------------

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
    const apiKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!apiKey) {
      console.error("STRIPE_SECRET_KEY is not set");
      return json({ error: "Billing is not configured" }, 500);
    }
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      console.error("Supabase env vars unavailable");
      return json({ error: "Server misconfigured" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!bearer || bearer === SUPABASE_ANON_KEY) {
      return json({ error: "Sign in to manage your subscription" }, 401);
    }
    const user = await resolveUser(bearer);
    if (!user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = typeof body.mode === "string" ? body.mode : "subscription";
    const returnUrl = safeReturnUrl(body.return_url, "/settings");

    const customerId = await getOrCreateCustomer(apiKey, user.id, user.email);

    if (mode === "portal") {
      const session = await stripe(apiKey, "billing_portal/sessions", {
        customer: customerId,
        return_url: returnUrl,
      });
      return json({ url: session.url });
    }

    if (mode === "payment") {
      if (!TOPUP_PRICE_ID) {
        return json({ error: "Credit top-ups are not available" }, 400);
      }
      const session = await stripe(apiKey, "checkout/sessions", {
        mode: "payment",
        customer: customerId,
        line_items: [{ price: TOPUP_PRICE_ID, quantity: 1 }],
        // The webhook reads these to grant credits.
        payment_intent_data: {
          metadata: {
            user_id: user.id,
            grant_credits: String(TOPUP_CREDITS),
          },
        },
        metadata: { user_id: user.id, grant_credits: String(TOPUP_CREDITS) },
        success_url: `${returnUrl}?billing=topup-success`,
        cancel_url: `${returnUrl}?billing=cancelled`,
      });
      return json({ url: session.url });
    }

    if (mode !== "subscription") {
      return json({ error: "Unknown mode" }, 400);
    }

    const plan = typeof body.plan === "string" ? body.plan : "plus";
    const interval = body.interval === "yearly" ? "yearly" : "monthly";
    const priceId = await priceIdForPlan(plan, interval);
    if (!priceId) {
      console.error("No Stripe price configured for", plan, interval);
      return json({ error: "That plan isn't available yet" }, 400);
    }

    const session = await stripe(apiKey, "checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // Mirrored onto the subscription object so the webhook can attribute it
      // even if the Checkout Session record isn't handy.
      subscription_data: { metadata: { user_id: user.id, plan } },
      metadata: { user_id: user.id, plan },
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=cancelled`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return json({ error: "Couldn't start the billing session" }, 500);
  }
});
