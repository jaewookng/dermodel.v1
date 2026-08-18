// Receives Stripe webhooks and mirrors subscription state into Supabase, so
// entitlement checks are a single indexed read instead of a Stripe API call on
// every chat message.
//
// Handled events:
//   checkout.session.completed          -> map customer, grant top-up credits
//   customer.subscription.created       -> upsert billing_subscriptions
//   customer.subscription.updated       -> upsert (status / period / cancel_at)
//   customer.subscription.deleted       -> mark canceled
//   invoice.payment_failed              -> logged; Stripe moves the sub to
//                                          past_due and sends .updated
//
// Everything else is acknowledged with 200 and ignored -- returning non-2xx
// would make Stripe retry events we will never process.
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
//   ^ REQUIRED. Stripe signs with its own scheme and sends no Supabase JWT;
//     with the default verify_jwt every delivery would 401. The signature check
//     below is what authenticates the request.
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//          supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

const TOLERANCE_SECONDS = 300; // reject deliveries older than 5 minutes

// No CORS headers: this endpoint is server-to-server only and must never be
// callable from a browser page.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// --- Signature verification -------------------------------------------------
// Stripe-Signature: t=<unix ts>,v1=<hex hmac-sha256 of "<t>.<raw body>">

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const idx = p.indexOf("=");
      return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
    }),
  ) as Record<string, string>;

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    console.error("Webhook timestamp outside tolerance");
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, signature);
}

// --- Supabase REST helpers (service role) -----------------------------------

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
    throw new Error(`Supabase write failed (${res.status})`);
  }
  return res.status === 204 ? null : await res.json().catch(() => null);
}

// Insert the event id first. A duplicate delivery conflicts on the primary key
// and we skip processing, so credits can never be granted twice.
async function claimEvent(
  id: string,
  type: string,
  payload: unknown,
): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/billing_events`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ stripe_event_id: id, type, payload }),
  });
  if (res.status === 409) return false; // already processed
  if (!res.ok) {
    const body = await res.text();
    console.error("billing_events insert failed:", res.status, body);
    throw new Error("Could not record webhook event");
  }
  return true;
}

// --- Stripe read helper -----------------------------------------------------

async function stripeGet(
  apiKey: string,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("Stripe API error:", res.status, path, JSON.stringify(body));
    throw new Error(`Stripe request failed (${res.status})`);
  }
  return body as Record<string, unknown>;
}

// --- Event handling ---------------------------------------------------------

const toIso = (seconds: unknown): string | null =>
  typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;

// Resolve the Supabase user for a subscription: prefer the metadata stamped at
// checkout, otherwise fall back to the customer -> user mapping.
async function resolveUserId(
  apiKey: string,
  metadata: Record<string, unknown> | undefined,
  customerId: string | null,
): Promise<string | null> {
  const fromMetadata = metadata?.user_id;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;

  if (customerId) {
    const rows = (await rest(
      `billing_customers?stripe_customer_id=eq.${encodeURIComponent(customerId)}` +
        `&select=user_id&limit=1`,
    )) as Array<Record<string, unknown>>;
    if (rows.length > 0 && typeof rows[0].user_id === "string") {
      return rows[0].user_id;
    }
    // Last resort: the customer object itself carries the id we set at creation.
    const customer = await stripeGet(apiKey, `customers/${customerId}`);
    const meta = customer.metadata as Record<string, unknown> | undefined;
    if (typeof meta?.user_id === "string" && meta.user_id) return meta.user_id;
  }
  return null;
}

// Map a Stripe price id back to one of our plans; falls back to the metadata
// stamped at checkout, then to 'plus' (the only paid plan today).
async function resolvePlan(
  metadata: Record<string, unknown> | undefined,
  priceId: string | null,
): Promise<string> {
  if (priceId) {
    const rows = (await rest(
      `billing_plans?select=plan&or=(stripe_price_id_monthly.eq.${encodeURIComponent(priceId)},` +
        `stripe_price_id_yearly.eq.${encodeURIComponent(priceId)})&limit=1`,
    )) as Array<Record<string, unknown>>;
    if (rows.length > 0 && typeof rows[0].plan === "string") return rows[0].plan;
  }
  const fromMetadata = metadata?.plan;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  return "plus";
}

async function upsertSubscription(
  apiKey: string,
  subscription: Record<string, unknown>,
  forcedStatus?: string,
): Promise<void> {
  const metadata = subscription.metadata as Record<string, unknown> | undefined;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : null;

  const userId = await resolveUserId(apiKey, metadata, customerId);
  if (!userId) {
    console.error(
      "Could not attribute subscription to a user:",
      subscription.id,
    );
    return;
  }

  const items = subscription.items as Record<string, unknown> | undefined;
  const firstItem = (items?.data as Array<Record<string, unknown>> | undefined)
    ?.[0];
  const price = firstItem?.price as Record<string, unknown> | undefined;
  const priceId = typeof price?.id === "string" ? price.id : null;
  const plan = await resolvePlan(metadata, priceId);

  await rest("billing_subscriptions?on_conflict=stripe_subscription_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      plan,
      status: forcedStatus ?? String(subscription.status ?? "incomplete"),
      current_period_start: toIso(subscription.current_period_start),
      current_period_end: toIso(subscription.current_period_end),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: new Date().toISOString(),
    }),
  });
}

async function handleCheckoutCompleted(
  apiKey: string,
  session: Record<string, unknown>,
): Promise<void> {
  const metadata = session.metadata as Record<string, unknown> | undefined;
  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  const userId = await resolveUserId(apiKey, metadata, customerId);
  if (!userId) {
    console.error("Checkout session without an attributable user:", session.id);
    return;
  }

  // Make sure the mapping exists even if the customer was created outside the
  // create-checkout-session function (e.g. a manual Stripe dashboard action).
  if (customerId) {
    await rest("billing_customers?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  if (session.mode === "subscription" && typeof session.subscription === "string") {
    const subscription = await stripeGet(
      apiKey,
      `subscriptions/${session.subscription}`,
    );
    await upsertSubscription(apiKey, subscription);
    return;
  }

  if (session.mode === "payment" && session.payment_status === "paid") {
    const credits = Number(metadata?.grant_credits ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) return;
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null;
    // stripe_payment_intent_id is UNIQUE, so this is a second layer of
    // idempotency on top of billing_events.
    await rest("chat_credit_grants?on_conflict=stripe_payment_intent_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        credits: Math.floor(credits),
        source: "topup",
        stripe_payment_intent_id: paymentIntentId,
      }),
    });
  }
}

// --- Handler ----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!apiKey || !webhookSecret) {
    console.error("STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set");
    return new Response("Billing is not configured", { status: 500 });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Supabase env vars unavailable");
    return new Response("Server misconfigured", { status: 500 });
  }

  // The signature is over the EXACT bytes Stripe sent -- read the raw body and
  // never re-serialize it before verifying.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Stripe-Signature") ?? "";
  if (!signatureHeader) return new Response("Missing signature", { status: 400 });

  let valid = false;
  try {
    valid = await verifySignature(rawBody, signatureHeader, webhookSecret);
  } catch (err) {
    console.error("Signature verification threw:", err);
  }
  if (!valid) return new Response("Invalid signature", { status: 400 });

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventId = String(event.id ?? "");
  const type = String(event.type ?? "");
  const object = (event.data as Record<string, unknown> | undefined)?.object as
    | Record<string, unknown>
    | undefined;
  if (!eventId || !type || !object) {
    return new Response("Malformed event", { status: 400 });
  }

  try {
    const fresh = await claimEvent(eventId, type, event);
    if (!fresh) {
      // Stripe replayed a delivery we already handled.
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    switch (type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(apiKey, object);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await upsertSubscription(apiKey, object);
        break;

      case "customer.subscription.deleted":
        await upsertSubscription(apiKey, object, "canceled");
        break;

      case "invoice.payment_failed":
        // Stripe flips the subscription to past_due and sends a separate
        // customer.subscription.updated; nothing to write here. Logged so a
        // dunning notification can be wired up later.
        console.warn("Invoice payment failed:", object.id, object.customer);
        break;

      default:
        // Acknowledge unhandled types so Stripe stops retrying them.
        break;
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-webhook error:", type, err);
    // Release the claim so Stripe's retry actually reprocesses the event
    // instead of being skipped as a duplicate. Best-effort: if this delete
    // fails the event stays claimed and must be replayed from the Stripe
    // dashboard after deleting the billing_events row by hand.
    try {
      await rest(
        `billing_events?stripe_event_id=eq.${encodeURIComponent(eventId)}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } },
      );
    } catch (cleanupErr) {
      console.error("Failed to release event claim:", eventId, cleanupErr);
    }
    // 500 makes Stripe retry with backoff.
    return new Response("Processing failed", { status: 500 });
  }
});
