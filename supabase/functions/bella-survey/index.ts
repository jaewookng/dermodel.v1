// Public endpoint behind the links in Bella's check-in emails.
//
// Both actions are reached from an email with NO logged-in session, so they're
// authorised by an unguessable token rather than a JWT, and written with the
// service role after the token is validated. Nothing here trusts a user id from
// the request body.
//
//   POST { action: "load",        token }  -> the check-in this survey is for
//   POST { action: "submit",      token, skin_rating?, product_rating?,
//                                 would_repurchase?, notes? }
//   POST { action: "unsubscribe", token }  -> token here is profiles.email_token
//
// Deploy: supabase functions deploy bella-survey
// Secrets: none beyond the auto-injected SUPABASE_SERVICE_ROLE_KEY.

import { getSecretKey } from "../_shared/keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = getSecretKey();

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

const enc = encodeURIComponent;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** 1-5, or null. Anything else is dropped rather than clamped. */
const rating = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Server misconfigured" }, 500);

  try {
    const body = await req.json().catch(() => null);
    const action = String(body?.action ?? "");
    const token = String(body?.token ?? "");

    // Reject anything that isn't shaped like a token before it reaches the DB.
    if (!UUID_RE.test(token)) return json({ error: "Invalid link" }, 400);

    if (action === "unsubscribe") {
      const res = await rest(`profiles?email_token=eq.${enc(token)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ checkin_emails_enabled: false }),
      });
      if (!res.ok) {
        console.error("unsubscribe failed:", res.status, await res.text());
        return json({ error: "Could not unsubscribe" }, 500);
      }
      const rows = await res.json();
      // Same response whether or not the token matched: a 404 here would let
      // someone probe which tokens are real.
      return json({ ok: true, unsubscribed: Array.isArray(rows) && rows.length > 0 });
    }

    // --- survey: load / submit ---
    const lookup = await rest(
      `bella_checkins?survey_token=eq.${enc(token)}` +
        `&select=id,responded_at,cabinet_items(product_id,opened_on,sss_products(product_name))`,
    );
    if (!lookup.ok) {
      console.error("checkin lookup failed:", lookup.status, await lookup.text());
      return json({ error: "Could not load this check-in" }, 500);
    }
    const [checkin] = (await lookup.json()) as Array<Record<string, unknown>>;
    if (!checkin) return json({ error: "This link is no longer valid" }, 404);

    const item = checkin.cabinet_items as Record<string, unknown> | null;
    const productRow = item?.sss_products as Record<string, unknown> | null;
    const productName = productRow?.product_name ?? null;

    if (action === "load") {
      return json({
        product_name: productName,
        opened_on: item?.opened_on ?? null,
        already_answered: !!checkin.responded_at,
      });
    }

    if (action !== "submit") return json({ error: "Unknown action" }, 400);

    const notesRaw = body?.notes;
    const notes = typeof notesRaw === "string" && notesRaw.trim()
      ? notesRaw.trim().slice(0, 2000)
      : null;
    const payload = {
      checkin_id: checkin.id,
      skin_rating: rating(body?.skin_rating),
      product_rating: rating(body?.product_rating),
      would_repurchase: typeof body?.would_repurchase === "boolean"
        ? body.would_repurchase
        : null,
      notes,
    };

    // Upsert on the unique checkin_id so a double submit edits rather than 409s.
    const insert = await rest("checkin_survey_responses?on_conflict=checkin_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    });
    if (!insert.ok) {
      console.error("survey insert failed:", insert.status, await insert.text());
      return json({ error: "Could not save your answers" }, 500);
    }

    await rest(`bella_checkins?id=eq.${enc(String(checkin.id))}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ responded_at: new Date().toISOString() }),
    });

    return json({ ok: true, product_name: productName });
  } catch (err) {
    console.error("bella-survey error:", err);
    return json({ error: "Something went wrong" }, 500);
  }
});
