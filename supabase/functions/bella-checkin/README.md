# `bella-checkin` + `bella-survey`

Bella's replenishment loop — the recurring half of the product. `bella-checkin`
is the daily cron that emails people when something is about to run out;
`bella-survey` is the public endpoint behind the links in that email.

## No LLM here either

Same posture as `bella-hooks`. *When* to email is arithmetic:

```
days_supply       = size_ml / (dose_ml × uses_per_day)
estimated_empty   = opened_on + days_supply
send when          CURRENT_DATE is within 7 days of estimated_empty
```

*What* to suggest is the same few-hop traversal the hooks use: pick a
distinctive ingredient from the expiring product, find other products with it,
subtract what they already own or saved.

`size_ml` and `dose_ml` come from `dermodel_parse_size_ml()` and
`dermodel_dose_ml()` (see `20260823_bella_memory.sql`). Product names in this
dataset carry their size — "…Ampoule, 1.01 fl oz/30 mL" — so **89% of products
size themselves with no user input** (measured against 600 live names). The rest
return NULL and are skipped rather than guessed.

## ⚠️ What we cannot do yet

`sss_products` has **no price and no first-seen date**. So "products that
recently entered the market" and "products that got cheaper" — both wanted for
this email — **are not currently computable**. The referral block ships as
"products that share what makes yours work", which is honest against the data we
have. Both need a new data source (retailer feed / price scrape) before they can
be built.

## Scheduling

`bella-checkin` is idempotent and safe to run repeatedly. Invoke daily:

```sql
select cron.schedule(
  'bella-checkin-daily', '0 14 * * *',
  $$ select net.http_post(
       url     := 'https://<project-ref>.functions.supabase.co/bella-checkin',
       headers := '{"Content-Type":"application/json","x-cron-secret":"<CHECKIN_CRON_SECRET>"}'::jsonb,
       body    := '{}'::jsonb
     ) $$
);
```

Needs `pg_cron` + `pg_net` enabled. Any scheduler works; the endpoint just needs
the `x-cron-secret` header.

## Safety properties

- **Not publicly triggerable** — requires `x-cron-secret`. It sends real email.
- **Claim-then-send.** The row in `bella_checkins` is inserted *before* the
  email goes out, and `UNIQUE (cabinet_item_id, cycle_key)` means a retried or
  double-scheduled run loses the race instead of emailing someone twice. If the
  send then fails, the claim is deleted so the next run retries.
- **`MAX_PER_RUN = 200`** caps the blast radius of a bad run.
- **Premium only** — enforced inside `bella_checkin_candidates()`, not at the
  call site, so it can't be forgotten. Written as `NOT IN ('free','anon')` so a
  plan rename can't silently switch everyone's check-ins on.
- **No nagging** — an item more than 14 days past its estimate is dropped
  (they stopped using it; they don't need a reminder).
- **Unsubscribe** in every send, honoured by `checkin_emails_enabled`.

## Secrets / env

| Var | Used by | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | checkin | Same key as `notify-product-submission`. |
| `CHECKIN_CRON_SECRET` | checkin | Any long random string. |
| `APP_ORIGIN` | checkin | Builds the survey + unsubscribe links. |
| `CHECKIN_FROM` | checkin | Optional; defaults to `Bella <bella@dermodel.app>`. |
| **`CHECKIN_POSTAL_ADDRESS`** | checkin | **Required.** Physical postal address rendered in the footer. **The run refuses to send without it** — see below. |
| `SUPABASE_SERVICE_ROLE_KEY` | both | Auto-injected. |

`bella-survey` needs no secrets of its own. It's public by necessity (the links
are opened from an email with no session) and is authorised by unguessable
tokens: `bella_checkins.survey_token` and `profiles.email_token`. It validates
the UUID shape before touching the database, and returns the same response for a
matched and unmatched unsubscribe token so the endpoint can't be used to probe
which tokens are real.

## ⚠️ The postal address is not optional

CAN-SPAM (15 U.S.C. §7704(a)(5)(A)(iii)) requires a valid physical postal
address in commercial email. The three-product referral block makes this message
commercial rather than purely transactional under 16 CFR 316.3(b), so a working
unsubscribe alone is not sufficient. There is no safe default, so
`CHECKIN_POSTAL_ADDRESS` is required and the function **returns 500 and sends
nothing** when it is unset — a loud failure at deploy beats a silent compliance
gap repeated on every send.

This is engineering prudence, not legal advice; see `docs/region-policy-review.md`
and have a lawyer confirm the classification and the wording.

## Deploy

```bash
supabase db push                              # 20260823_bella_memory.sql
supabase secrets set CHECKIN_CRON_SECRET=... APP_ORIGIN=https://dermodel.app \
  CHECKIN_POSTAL_ADDRESS="Dermodel, 123 Example St, Austin, TX 78701, USA"
supabase functions deploy bella-checkin
supabase functions deploy bella-survey
```

Verify `dermodel.app` as a Resend sending domain first — this sends from
`bella@`, where the existing function sends from `submissions@`.
