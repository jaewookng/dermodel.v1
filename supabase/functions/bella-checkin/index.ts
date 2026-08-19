// Bella's replenishment check-in — the recurring half of the product.
//
// Cron-invoked (daily). Finds cabinet items about to run out, emails the owner
// asking how their skin is doing and how they liked the product, and suggests
// a few alternatives. DELIBERATELY ZERO LLM, same posture as `bella-hooks`:
// when to send is arithmetic (size ÷ dose × frequency) and what to suggest is a
// few-hop traversal over our own tables. Nothing here needs a model.
//
// Request:  POST {}  with header `x-cron-secret: <CHECKIN_CRON_SECRET>`
// Response: JSON { considered, sent, failed, skipped }
//
// Deploy: supabase functions deploy bella-checkin
// Secrets: RESEND_API_KEY, CHECKIN_CRON_SECRET, APP_ORIGIN

import { getSecretKey } from "../_shared/keys.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = getSecretKey();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CHECKIN_CRON_SECRET") ?? "";
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://dermodel.app";
const FROM_ADDRESS = Deno.env.get("CHECKIN_FROM") ?? "Bella <bella@dermodel.app>";
// REQUIRED. CAN-SPAM (15 U.S.C. §7704(a)(5)(A)(iii)) requires a valid physical
// postal address in commercial email, and the three-product referral block in
// this message makes it commercial rather than purely transactional under
// 16 CFR 316.3(b). There is no safe default to fall back to, so the run refuses
// to send without it -- a loud config error beats a silent compliance gap on
// every send. See docs/region-policy-review.md.
const POSTAL_ADDRESS = Deno.env.get("CHECKIN_POSTAL_ADDRESS") ?? "";

/** Never email more than this many people in one run (blast-radius guard). */
const MAX_PER_RUN = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const enc = encodeURIComponent;

interface Candidate {
  cabinet_item_id: string;
  user_id: string;
  email: string;
  username: string | null;
  email_token: string;
  product_id: string;
  product_name: string;
  opened_on: string;
  days_supply: number;
  estimated_empty_on: string;
  cycle_key: string;
}

async function rest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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

async function restGet(path: string): Promise<unknown[]> {
  const res = await rest(path);
  if (!res.ok) {
    console.error("Supabase REST error:", res.status, path, await res.text());
    throw new Error(`Supabase query failed (${res.status})`);
  }
  return await res.json();
}

/** Swallows errors so one unbuildable section never blocks the send. */
async function tryGet(path: string): Promise<unknown[]> {
  try {
    return await restGet(path);
  } catch {
    return [];
  }
}

function shortName(name: string): string {
  const base = name.split(/,|—| - /)[0].trim();
  const words = base.split(/\s+/);
  return words.length <= 7 ? base : words.slice(0, 7).join(" ");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// --- Referrals: same few-hop traversal as bella-hooks ----------------------
//
// ⚠️ We can suggest "similar and well-liked" and "paraben free", but NOT
// "recently launched" or "got cheaper": `sss_products` carries no price and no
// first-seen date. Those two need a new data source before they can be honest.

async function buildReferrals(
  productId: string,
  userId: string,
): Promise<Array<{ product_id: string; product_name: string }>> {
  // Hop 1: the expiring product's ingredients.
  const joinRows = (await tryGet(
    `sss_product_ingredients_join?product_id=eq.${enc(productId)}` +
      `&select=sss_ingredients(ingredient_id,ingredient_name,product_count,like_count)` +
      `&limit=60`,
  )) as Array<Record<string, unknown>>;

  const ingredients = joinRows
    .map((r) => r.sss_ingredients as Record<string, unknown> | null)
    .filter((i): i is Record<string, unknown> => !!i)
    .map((i) => ({
      id: String(i.ingredient_id ?? ""),
      product_count: Number(i.product_count ?? 0),
      like_count: Number(i.like_count ?? 0),
    }))
    .filter((i) => i.id);

  // A characterful ingredient, not water/glycerin.
  const distinctive = ingredients
    .filter((i) => i.product_count >= 15 && i.product_count <= 4000)
    .sort((a, b) => b.like_count - a.like_count || a.product_count - b.product_count)[0];
  if (!distinctive) return [];

  // Hop 2: other products built on it.
  const neighbourRows = (await tryGet(
    `sss_product_ingredients_join?ingredient_id=eq.${enc(distinctive.id)}` +
      `&select=sss_products(product_id,product_name,like_count)` +
      `&order=sss_products(like_count).desc.nullslast&limit=40`,
  )) as Array<Record<string, unknown>>;

  // Don't recommend what they already own or already saved.
  const owned = new Set<string>([productId]);
  for (
    const r of (await tryGet(
      `cabinet_items?user_id=eq.${enc(userId)}&select=product_id`,
    )) as Array<Record<string, unknown>>
  ) owned.add(String(r.product_id ?? ""));
  for (
    const r of (await tryGet(
      `product_favorites?user_id=eq.${enc(userId)}&select=product_id`,
    )) as Array<Record<string, unknown>>
  ) owned.add(String(r.product_id ?? ""));

  return neighbourRows
    .map((r) => r.sss_products as Record<string, unknown> | null)
    .filter((p): p is Record<string, unknown> => !!p)
    .map((p) => ({
      product_id: String(p.product_id ?? ""),
      product_name: String(p.product_name ?? ""),
    }))
    .filter((p) => p.product_id && p.product_name && !owned.has(p.product_id))
    .slice(0, 3);
}

// --- Email ------------------------------------------------------------------

function renderEmail(c: Candidate, referrals: Array<{ product_name: string }>) {
  const greeting = c.username ? `Hi ${escapeHtml(c.username)},` : "Hi,";
  const product = escapeHtml(shortName(c.product_name));
  const surveyUrl = `${APP_ORIGIN}/checkin/${c.survey_token}`;
  const unsubUrl = `${APP_ORIGIN}/unsubscribe/${c.email_token}`;

  const referralHtml = referrals.length === 0 ? "" : `
    <p style="margin:24px 0 8px;font-size:14px;color:#111">
      If you're replacing it, these share what makes it work:
    </p>
    <ul style="margin:0;padding-left:18px;font-size:14px;color:#444;line-height:1.7">
      ${referrals.map((r) => `<li>${escapeHtml(shortName(r.product_name))}</li>`).join("")}
    </ul>`;

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
  <p style="font-size:15px;color:#111;margin:0 0 16px">${greeting}</p>
  <p style="font-size:15px;color:#111;line-height:1.6;margin:0 0 16px">
    Your <strong>${product}</strong> should be running low right about now —
    you opened it ${c.days_supply} days ago.
  </p>
  <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 24px">
    How has your skin been getting on with it? It takes about thirty seconds to
    tell me, and it makes what I suggest next actually useful.
  </p>
  <a href="${surveyUrl}"
     style="display:inline-block;background:#f9a8c4;color:#fff;text-decoration:none;
            padding:11px 22px;border-radius:999px;font-size:14px;font-weight:600">
    How did it go?
  </a>
  ${referralHtml}
  <p style="margin:28px 0 0;font-size:12px;color:#999;line-height:1.6">
    This estimate is based on the bottle size and how often you said you use it,
    so it's a guess — you know better than I do.<br>
    <a href="${unsubUrl}" style="color:#999">Unsubscribe from check-ins</a>
  </p>
  <p style="margin:12px 0 0;font-size:11px;color:#bbb;line-height:1.5">
    ${escapeHtml(POSTAL_ADDRESS)}
  </p>
</div>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html,
      headers: { "List-Unsubscribe": "<mailto:unsubscribe@dermodel.app>" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
  }
}

// --- Handler ----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  // This endpoint emails real people; it must not be publicly triggerable.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Server misconfigured" }, 500);
  if (!RESEND_API_KEY) return json({ error: "Email is not configured" }, 500);
  if (!POSTAL_ADDRESS) {
    console.error(
      "CHECKIN_POSTAL_ADDRESS is not set; refusing to send. Commercial email " +
        "requires a physical postal address (CAN-SPAM 15 U.S.C. §7704(a)(5)).",
    );
    return json({ error: "Sender postal address is not configured" }, 500);
  }

  try {
    const res = await rest("rpc/bella_checkin_candidates", {
      method: "POST",
      body: JSON.stringify({ p_lead_days: 7 }),
    });
    if (!res.ok) {
      console.error("candidates rpc failed:", res.status, await res.text());
      return json({ error: "Could not load candidates" }, 500);
    }
    const candidates = (await res.json()) as Candidate[];
    const batch = candidates.slice(0, MAX_PER_RUN);

    let sent = 0, failed = 0;

    for (const c of batch) {
      // Claim the cycle BEFORE sending. The unique (cabinet_item_id, cycle_key)
      // constraint means a concurrent or retried run loses the race here rather
      // than sending a second copy to the same person.
      const claim = await rest("bella_checkins", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: c.user_id,
          cabinet_item_id: c.cabinet_item_id,
          cycle_key: c.cycle_key,
        }),
      });
      if (!claim.ok) {
        // 409 = already claimed by another run. Anything else is a real error.
        if (claim.status !== 409) {
          console.error("claim failed:", claim.status, await claim.text());
          failed++;
        }
        continue;
      }
      const [row] = (await claim.json()) as Array<{ survey_token: string }>;
      const withToken = { ...c, survey_token: row.survey_token } as
        Candidate & { survey_token: string };

      try {
        const referrals = await buildReferrals(c.product_id, c.user_id);
        await sendEmail(
          c.email,
          `Your ${shortName(c.product_name)} is running low`,
          renderEmail(withToken, referrals),
        );
        sent++;
      } catch (err) {
        // Release the claim so the next run retries instead of silently
        // swallowing the check-in forever.
        console.error("send failed, releasing claim:", err);
        await rest(
          `bella_checkins?cabinet_item_id=eq.${enc(c.cabinet_item_id)}` +
            `&cycle_key=eq.${enc(c.cycle_key)}`,
          { method: "DELETE" },
        );
        failed++;
      }
    }

    return json({
      considered: candidates.length,
      sent,
      failed,
      skipped: candidates.length - batch.length,
    });
  } catch (err) {
    console.error("bella-checkin error:", err);
    return json({ error: "Check-in run failed" }, 500);
  }
});
