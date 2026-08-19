// Creates a Stripe-hosted session for the signed-in caller: either a Checkout
// session (start/upgrade a subscription, or buy a credit top-up) or a Billing
// Portal session (manage payment method, cancel, view invoices).
//
// Request:  POST { mode: "subscription" | "payment" | "portal",
//                  plan?: "premium",
//                  interval?: "monthly" | "semiannual" | "yearly",
//                  country?: string,      // weak client hint, ISO-3166 alpha-2
//                  return_url?: string }
// Response: JSON { url: string }   -- redirect the browser to it
//           403  { error, code: "region_unavailable", region_policy: "avoid" }
//
// REGION GATING. Premium is not sold into regions whose billing_region_policy
// row says 'avoid' (sanctions/embargo, or a tax/consumer-law burden the owner
// has decided against). This function is where that is ENFORCED -- hiding the
// upgrade button in the UI is a hint, not a control, because anyone can call
// this endpoint directly. See docs/payment-model.md section 9.
//
// Auth: REQUIRED. The caller's `Authorization: Bearer <supabase access token>`
// is verified server-side; the Stripe customer is keyed off that user id, never
// off anything in the request body.
//
// Deploy:  supabase functions deploy create-checkout-session
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.)

import { getSecretKey, getPublishableKey } from "../_shared/keys.ts";

const STRIPE_API = "https://api.stripe.com/v1";

// Where to send the user back to when they finish or abandon the flow. Only
// URLs on this origin are accepted as `return_url` (open-redirect guard).
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://dermodel.app";

// Price for the one-time credit top-up pack. Optional -- the "payment" mode is
// rejected when it isn't configured.
//
// Credits are denominated in milli-dollars of USER-FACING credit value
// (1000 credits = $1.00 of Bella credit), so the default 5000 is the "$5 more
// of Bella credits" pack. That $5 of credit is ~$0.45 of real Anthropic spend
// at the 12x markup -- the same margin shape as the subscription allowance.
// Override with STRIPE_TOPUP_CREDITS if the Stripe price changes.
const TOPUP_PRICE_ID = Deno.env.get("STRIPE_TOPUP_PRICE_ID") ?? "";
const TOPUP_CREDITS = Number(Deno.env.get("STRIPE_TOPUP_CREDITS") ?? "5000");

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
const SERVICE_ROLE_KEY = getSecretKey();

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

// The three billing intervals. Monthly is the anchor; the two prepay options
// trade a discount for cash up front (and, because Stripe's $0.30 is charged
// once per invoice rather than once per month, better fee efficiency -- see
// docs/payment-model.md section 4).
type Interval = "monthly" | "semiannual" | "yearly";

const PRICE_COLUMN: Record<Interval, string> = {
  monthly: "stripe_price_id_monthly",
  semiannual: "stripe_price_id_semiannual",
  yearly: "stripe_price_id_yearly",
};

function parseInterval(raw: unknown): Interval {
  if (raw === "yearly" || raw === "annual") return "yearly";
  if (raw === "semiannual" || raw === "6month" || raw === "six_month") {
    return "semiannual";
  }
  return "monthly";
}

// Resolve the Stripe price id for a plan + interval from billing_plans, so
// price changes are a DB update rather than a redeploy.
async function priceIdForPlan(
  plan: string,
  interval: Interval,
): Promise<string | null> {
  const column = PRICE_COLUMN[interval];
  const rows = (await rest(
    `billing_plans?plan=eq.${encodeURIComponent(plan)}&select=${column}&limit=1`,
  )) as Array<Record<string, unknown>>;
  const value = rows[0]?.[column];
  return typeof value === "string" && value ? value : null;
}

// --- Region ------------------------------------------------------------------
// Two sources, two jobs (docs/payment-model.md section 9.3):
//
//   * The AUTHORITATIVE country is the billing address Stripe collects at
//     Checkout. It does not exist yet the first time someone reaches this
//     function, which is exactly why the stripe-webhook re-checks afterwards.
//   * Pre-checkout all we have is weak: a CDN geo header if the platform gave
//     us one, else a country the client claims. Both are recorded as
//     `declared_country`, never as `billing_country`.
//
// A lying client cannot use the hint to escape a block: billing_region_for_user
// treats an 'avoid' from EITHER source as decisive, so a false hint can only
// make the outcome stricter.

const GEO_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "x-country-code",
  "x-appengine-country",
];

function geoCountry(req: Request): { country: string; source: string } | null {
  for (const name of GEO_HEADERS) {
    const raw = req.headers.get(name);
    if (raw && /^[A-Za-z]{2}$/.test(raw.trim()) && raw.trim().toUpperCase() !== "XX") {
      return { country: raw.trim().toUpperCase(), source: "geo_header" };
    }
  }
  return null;
}

function clientCountryHint(body: Record<string, unknown>) {
  const raw = body.country;
  if (typeof raw === "string" && /^[A-Za-z]{2}$/.test(raw.trim())) {
    return { country: raw.trim().toUpperCase(), source: "user_selected" };
  }
  return null;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  return await rest(`rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

type Region = {
  country: string | null;
  country_source: string | null;
  policy: string;
  sell_premium: boolean;
  marketing_default_opt_in: boolean;
  conflicted: boolean;
};

async function resolveRegion(userId: string): Promise<Region> {
  const rows = (await rpc("billing_region_for_user", { p_user_id: userId })) as
    | Region[]
    | null;
  const row = Array.isArray(rows) ? rows[0] : null;
  // Fail CLOSED on an unreadable region: if we cannot tell where someone is,
  // we do not take their money. A DB outage should not become a compliance
  // incident, and the failure is loud and recoverable (they retry).
  return (
    row ?? {
      country: null,
      country_source: "unresolved",
      policy: "avoid",
      sell_premium: false,
      marketing_default_opt_in: false,
      conflicted: false,
    }
  );
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

    // Record the weak pre-checkout signal before resolving policy, so a first
    // visit from an 'avoid' region is blocked on this same request rather than
    // on the next one. Best effort: never fail checkout over a hint.
    const hint = geoCountry(req) ?? clientCountryHint(body);
    if (hint) {
      try {
        await rpc("set_declared_country", {
          p_user_id: user.id,
          p_country: hint.country,
          p_source: hint.source,
        });
      } catch {
        // ignore
      }
    }

    const customerId = await getOrCreateCustomer(apiKey, user.id, user.email);

    if (mode === "portal") {
      // The portal is NOT region gated on purpose. Someone whose region moved
      // to 'avoid' after they subscribed must still be able to cancel, update
      // a card, and pull their invoices -- blocking that would trap them.
      const session = await stripe(apiKey, "billing_portal/sessions", {
        customer: customerId,
        return_url: returnUrl,
      });
      return json({ url: session.url });
    }

    // --- Region gate: everything below this line takes money -----------------
    const region = await resolveRegion(user.id);
    if (!region.sell_premium) {
      console.warn(
        "Blocked paid flow for region:",
        user.id,
        region.country,
        region.country_source,
        region.policy,
      );
      return json({
        error: "Premium isn't available in your region yet.",
        code: "region_unavailable",
        region_policy: region.policy,
        region_country: region.country,
      }, 403);
    }

    if (mode === "payment") {
      if (!TOPUP_PRICE_ID) {
        return json({ error: "Credit top-ups are not available" }, 400);
      }
      if (!Number.isFinite(TOPUP_CREDITS) || TOPUP_CREDITS <= 0) {
        console.error("STRIPE_TOPUP_CREDITS is not a positive number");
        return json({ error: "Credit top-ups are not available" }, 400);
      }
      const session = await stripe(apiKey, "checkout/sessions", {
        mode: "payment",
        customer: customerId,
        // Required so the webhook always has an authoritative country to
        // verify the region gate against after the fact.
        billing_address_collection: "required",
        customer_update: { address: "auto" },
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

    const plan = typeof body.plan === "string" ? body.plan : "premium";
    const interval = parseInterval(body.interval);
    const priceId = await priceIdForPlan(plan, interval);
    if (!priceId) {
      console.error("No Stripe price configured for", plan, interval);
      return json({ error: "That plan isn't available yet" }, 400);
    }

    const session = await stripe(apiKey, "checkout/sessions", {
      mode: "subscription",
      customer: customerId,
      // Stripe has no billing-country allowlist for Checkout, so the country
      // cannot be PREVENTED here -- it can only be collected and verified.
      // Requiring the address is what makes the webhook's post-hoc check
      // (stripe-webhook, region_blocked) possible at all.
      billing_address_collection: "required",
      customer_update: { address: "auto" },
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // Mirrored onto the subscription object so the webhook can attribute it
      // even if the Checkout Session record isn't handy.
      subscription_data: { metadata: { user_id: user.id, plan, interval } },
      metadata: { user_id: user.id, plan, interval },
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=cancelled`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return json({ error: "Couldn't start the billing session" }, 500);
  }
});
