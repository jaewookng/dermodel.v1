// Emails admin@dermodel.app when a user submits a product suggestion.
// Best-effort side channel: the submission row is already stored in
// product_submissions by the client before this runs, so a failure here
// never loses data.
//
// Deploy:  supabase functions deploy notify-product-submission
// Secret:  supabase secrets set RESEND_API_KEY=re_...   (resend.com, with
//          dermodel.app verified as a sending domain)

const ADMIN_EMAIL = "admin@dermodel.app";
const FROM_ADDRESS = "Dermodel Submissions <submissions@dermodel.app>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { product_url, product_name } = await req.json();

    // Same constraints as the product_submissions table
    if (
      typeof product_url !== "string" ||
      product_url.length === 0 ||
      product_url.length > 2048 ||
      !/^https?:\/\//i.test(product_url)
    ) {
      return new Response(JSON.stringify({ error: "Invalid product_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const name =
      typeof product_name === "string" && product_name.trim()
        ? product_name.trim().slice(0, 200)
        : null;

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      console.error("RESEND_API_KEY is not set; skipping email");
      return new Response(JSON.stringify({ error: "Email not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [ADMIN_EMAIL],
        subject: `New product submission${name ? `: ${name}` : ""}`,
        html: `
          <h2>New product submission</h2>
          <p><strong>Product:</strong> ${name ? escapeHtml(name) : "(no name given)"}</p>
          <p><strong>Link:</strong> <a href="${escapeHtml(product_url)}">${escapeHtml(product_url)}</a></p>
          <p>Review pending submissions in the Supabase dashboard
          (<code>product_submissions</code> table).</p>
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("Resend error:", res.status, body);
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-product-submission error:", err);
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
