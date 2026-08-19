// Receives Stripe webhooks and mirrors subscription state into Supabase, so
// entitlement checks are a single indexed read instead of a Stripe API call on
// every chat message.
//
// Handled events:
//   checkout.session.completed          -> map customer, grant top-up credits
//   customer.subscription.created       -> upsert billing_subscriptions
//   customer.subscription.updated       -> upsert (status / period / cancel_at)
//   customer.subscription.deleted       -> mark canceled
//   invoice.paid                        -> refresh the subscription mirror so
//                                          current_period_end is right for all
//                                          three billing intervals
//   invoice.payment_failed              -> logged; Stripe moves the sub to
//                                          past_due and sends .updated
//
// REGION VERIFICATION. create-checkout-session refuses to open a paid session
// for a region whose billing_region_policy row says 'avoid', but that check can
// only use what we know BEFORE checkout (a CDN geo header, or nothing at all).
// The authoritative country is the billing address Stripe collects during
// Checkout, which only exists here. So this function writes that country to
// billing_user_region.billing_country and, if the region resolves to 'avoid',
// sets billing_subscriptions.region_blocked for operator review.
//
// It deliberately does NOT auto-cancel. The customer has paid and the product
// works; silently revoking access on a webhook is a worse failure than a flag
// a human refunds and cancels. Query billing_region_review for the queue.
//
// NOTE ON THE MONTHLY CREDIT GRANT: the $10/mo Bella allowance is NOT granted
// here. It comes from billing_plans.monthly_credits evaluated per CALENDAR
// MONTH inside consume_chat_turn(). That is deliberate:
//   * it is interval-agnostic -- a 6-month or 12-month prepay still gets $10
//     each month, whereas "grant on invoice.paid" would grant $10 once every
//     6 or 12 months;
//   * a dropped or delayed webhook can never cost a paying customer their
//     allowance, because there is nothing to drop.
// chat_credit_grants stays for top-up purchases, promos, and support goodwill;
// stripe_invoice_id is available there for one-off idempotent operator grants.
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

import { getSecretKey } from "../_shared/keys.ts";

const TOLERANCE_SECONDS = 300; // reject deliveries older than 5 minutes

// No CORS headers: this endpoint is server-to-server only and must never be
// callable from a browser page.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = getSecretKey();

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

// --- Region verification ----------------------------------------------------

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  return await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
}

type Region = {
  country: string | null;
  policy: string;
  sell_premium: boolean;
};

// Pull the billing country out of whichever Stripe object we have. Checkout
// Sessions carry it on customer_details.address; Customers on address.
function countryFrom(obj: Record<string, unknown> | undefined): string | null {
  if (!obj) return null;
  const details = obj.customer_details as Record<string, unknown> | undefined;
  const addr = (details?.address ?? obj.address) as
    | Record<string, unknown>
    | undefined;
  const country = addr?.country;
  return typeof country === "string" && /^[A-Za-z]{2}$/.test(country)
    ? country.toUpperCase()
    : null;
}

// Record the authoritative country and return the resolved region. Best
// effort: a region write must never break the subscription mirror, because a
// wrong entitlement is a worse outcome than a late region flag.
async function verifyRegion(
  userId: string,
  country: string | null,
): Promise<Region | null> {
  try {
    if (country) {
      await rpc("set_billing_country", {
        p_user_id: userId,
        p_country: country,
        p_source: "stripe_checkout",
      });
    }
    const rows = (await rpc("billing_region_for_user", { p_user_id: userId })) as
      | Region[]
      | null;
    return Array.isArray(rows) ? rows[0] ?? null : null;
  } catch (err) {
    console.error("Region verification failed for", userId, err);
    return null;
  }
}

async function flagRegionBlocked(
  stripeSubscriptionId: string,
  region: Region,
): Promise<void> {
  console.error(
    "REGION BLOCK: paid subscription from an 'avoid' region:",
    stripeSubscriptionId,
    region.country,
  );
  try {
    await rest(
      `billing_subscriptions?stripe_subscription_id=eq.${
        encodeURIComponent(stripeSubscriptionId)
      }`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          region_blocked: true,
          region_blocked_reason:
            `billing country ${region.country ?? "unknown"} resolves to ` +
            `policy '${region.policy}'; refund and cancel manually`,
        }),
      },
    );
  } catch (err) {
    console.error("Could not flag region_blocked:", stripeSubscriptionId, err);
  }
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
// stamped at checkout, then to 'premium' (the only paid plan today). All three
// billing intervals (monthly / semiannual / yearly) map to the same plan row --
// the interval changes the price, never the entitlement.
async function resolvePlan(
  metadata: Record<string, unknown> | undefined,
  priceId: string | null,
): Promise<string> {
  if (priceId) {
    const rows = (await rest(
      `billing_plans?select=plan&or=(stripe_price_id_monthly.eq.${encodeURIComponent(priceId)},` +
        `stripe_price_id_semiannual.eq.${encodeURIComponent(priceId)},` +
        `stripe_price_id_yearly.eq.${encodeURIComponent(priceId)})&limit=1`,
    )) as Array<Record<string, unknown>>;
    if (rows.length > 0 && typeof rows[0].plan === "string") return rows[0].plan;
  }
  const fromMetadata = metadata?.plan;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
  return "premium";
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

  // Authoritative region check. The country comes from the Customer object
  // (Checkout wrote it there via customer_update[address]=auto). Resolved
  // BEFORE the upsert but FLAGGED after it -- on a first subscription the row
  // does not exist yet, so a PATCH here would silently match nothing.
  let region: Region | null = null;
  if (customerId) {
    try {
      const customer = await stripeGet(apiKey, `customers/${customerId}`);
      region = await verifyRegion(userId, countryFrom(customer));
    } catch (err) {
      console.error("Region check skipped for", subscription.id, err);
    }
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

  if (region && !region.sell_premium && typeof subscription.id === "string") {
    await flagRegionBlocked(subscription.id, region);
  }
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

  // Record the collected billing address country regardless of mode. For the
  // subscription path upsertSubscription re-checks and flags; for a one-off
  // top-up there is no subscription row to flag, so the block is logged and the
  // grant is refused outright -- a top-up is a fresh purchase decision and
  // there is no paid-access-in-flight to protect.
  const checkoutRegion = await verifyRegion(userId, countryFrom(session));

  if (session.mode === "subscription" && typeof session.subscription === "string") {
    const subscription = await stripeGet(
      apiKey,
      `subscriptions/${session.subscription}`,
    );
    await upsertSubscription(apiKey, subscription);
    return;
  }

  if (session.mode === "payment" && session.payment_status === "paid") {
    if (checkoutRegion && !checkoutRegion.sell_premium) {
      console.error(
        "REGION BLOCK: top-up paid from an 'avoid' region; credits withheld:",
        session.id,
        checkoutRegion.country,
      );
      return;
    }
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

      case "invoice.paid": {
        // Renewals (and the first prepay invoice) move current_period_end.
        // Re-reading the subscription keeps the mirror -- and therefore the
        // renewal date the Settings billing card shows -- accurate for
        // monthly, 6-month, and annual subscribers alike. No credits are
        // granted here; see the note at the top of this file.
        const subscriptionId = object.subscription;
        if (typeof subscriptionId === "string" && subscriptionId) {
          const subscription = await stripeGet(
            apiKey,
            `subscriptions/${subscriptionId}`,
          );
          await upsertSubscription(apiKey, subscription);
        }
        break;
      }

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
