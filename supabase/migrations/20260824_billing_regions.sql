-- Billing v3: 12x markup, LIFETIME free-tier conversations, and region-driven
-- selling / email-consent policy.
--
-- Prerequisites and idempotency posture
-- ------------------------------------
--   * 20260818_billing.sql is ALREADY APPLIED in production and is not edited.
--   * 20260821_billing_pricing_v2.sql may or may not have been applied yet.
--     `supabase db push` applies files in filename order, so in practice it runs
--     immediately before this one -- but this file does NOT rely on that. Every
--     object 20260821 introduces that this file needs is re-declared here with
--     IF NOT EXISTS / ON CONFLICT DO NOTHING, so the statements are exact no-ops
--     when 20260821 already ran and are self-sufficient when it did not. The
--     duplication is deliberate; do not "clean it up" by deleting it.
--   * Every statement in this file is re-runnable.
--
-- What changed from v2 (see docs/payment-model.md section 1, v2 -> v3 table):
--
--   1. markup_multiple 11.12 -> 12. The consumer price of a standard message
--      stays $0.10 and $10 still buys 100 messages; what tightens is the REAL
--      cost budget behind that price: $0.10 / 12 = $0.008333 per turn, down
--      from $0.009. assumed_turn_cost_usd moves accordingly.
--   2. The free tier is 5 conversations PER LIFETIME, not per month. The
--      counter lives in chat_lifetime_conversations, which has no foreign key
--      to profiles and is therefore not reset by signing out, clearing
--      localStorage, or deleting and recreating the account.
--   3. Region policy (always_on / consent_first / avoid) is data in
--      billing_region_policy, keyed by ISO 3166-1 alpha-2 country code, so the
--      policy for a country changes with an UPDATE and never with a deploy.
--
-- LEGAL REVIEW REQUIRED. The seeded country lists in section 5 are an
-- engineering starting point assembled by a non-lawyer. billing_region_policy
-- carries a legal_review_status column, seeded 'unreviewed' for every row.
-- Do not go live selling internationally until those rows are reviewed by
-- someone qualified and moved to 'reviewed'.

-- ===========================================================================
-- 0. Defensive re-declaration of the 20260821 surface this file builds on
-- ===========================================================================
-- No-ops when 20260821 has been applied.

CREATE TABLE IF NOT EXISTS billing_config (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read public billing config" ON billing_config;
CREATE POLICY "Anyone can read public billing config"
  ON billing_config FOR SELECT
  TO anon, authenticated
  USING (is_public);

DROP TRIGGER IF EXISTS billing_config_updated_at ON billing_config;
CREATE TRIGGER billing_config_updated_at
  BEFORE UPDATE ON billing_config
  FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();

INSERT INTO billing_config (key, value, description, is_public) VALUES
  ('credit_unit_usd', 0.001,
   'User-facing dollar value of one credit. 1000 credits = $1.00.', true),
  ('standard_turn_credits', 100,
   'Credits charged for one standard (Haiku) chat turn. 100 = $0.10.', true),
  ('deep_dive_turn_credits', 400,
   'Credits charged for one deep-dive (Sonnet) chat turn. 400 = $0.40.', true),
  ('markup_multiple', 12,
   'User-facing credit dollars per real Anthropic dollar.', false),
  ('assumed_turn_cost_usd', 0.008333,
   'Planning estimate of the real Anthropic cost of one standard turn.', false),
  ('conversation_idle_minutes', 30, 'Idle close threshold.', false),
  ('conversation_max_age_hours', 24, 'Absolute conversation lifetime.', false),
  ('free_tier_monthly_usd_cap', 500, 'Free-tier spend circuit breaker.', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION billing_config_num(p_key TEXT, p_default NUMERIC DEFAULT 0)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM billing_config WHERE key = p_key), p_default);
$$;

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS price_cents_semiannual INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_price_id_semiannual TEXT,
  ADD COLUMN IF NOT EXISTS metering_mode TEXT NOT NULL DEFAULT 'credits',
  ADD COLUMN IF NOT EXISTS monthly_conversations INTEGER,
  ADD COLUMN IF NOT EXISTS daily_conversations INTEGER,
  ADD COLUMN IF NOT EXISTS conversation_turn_cap INTEGER,
  ADD COLUMN IF NOT EXISTS credit_allowance_usd NUMERIC(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS includes_cabinet_memory BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_checkin_emails BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_surveys BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_referrals BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_plans_metering_mode_check'
  ) THEN
    ALTER TABLE billing_plans
      ADD CONSTRAINT billing_plans_metering_mode_check
      CHECK (metering_mode IN ('conversations', 'credits', 'none'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  anon_key_hash TEXT,
  plan TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_turn_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  turn_count INTEGER NOT NULL DEFAULT 0,
  closed_at TIMESTAMP WITH TIME ZONE,
  close_reason TEXT,
  CONSTRAINT chat_conversations_identity
    CHECK ((user_id IS NOT NULL) <> (anon_key_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_started
  ON chat_conversations (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_anon_started
  ON chat_conversations (anon_key_hash, started_at DESC);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own conversations" ON chat_conversations;
CREATE POLICY "Users can view their own conversations"
  ON chat_conversations FOR SELECT
  USING (auth.uid() = user_id);

ALTER TABLE chat_usage_events
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES chat_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assumed_cost_usd NUMERIC(10, 6);

CREATE INDEX IF NOT EXISTS idx_chat_usage_events_conversation
  ON chat_usage_events (conversation_id);

CREATE TABLE IF NOT EXISTS chat_spend_rollup (
  period_month DATE NOT NULL,
  scope TEXT NOT NULL,
  turns BIGINT NOT NULL DEFAULT 0,
  credits BIGINT NOT NULL DEFAULT 0,
  est_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_month, scope)
);

ALTER TABLE chat_spend_rollup ENABLE ROW LEVEL SECURITY;

ALTER TABLE chat_credit_grants
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_credit_grants_invoice
  ON chat_credit_grants (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- ===========================================================================
-- 1. Markup 11.12x -> 12x
-- ===========================================================================
-- The consumer-facing numbers are UNCHANGED: a standard message is still
-- $0.10 (100 credits), a deep dive still $0.40, and $10 still buys 100
-- messages. Raising the markup tightens the REAL-cost budget behind those
-- prices rather than raising the price:
--
--     real cost budget per standard turn = $0.10 / 12 = $0.008333
--     real cost at a fully consumed $10  = $10  / 12  = $0.8333
--     $0.8333 / $8.99 revenue            = 9.27% COGS
--     pre-Stripe gross margin @ 100%     = 90.73%
--
-- $0.008333 is the number to watch in the ledger. The measured typical turn is
-- $0.0067, so there is headroom, but a heavy tool-saturated turn (~$0.017)
-- is still 2x over budget -- which is what the p95 query in
-- docs/payment-model.md section 3 exists to catch.

UPDATE billing_config
   SET value = 12,
       description = 'User-facing credit dollars per real Anthropic dollar. '
                     'At 12x a fully consumed $10 allowance costs $0.8333, '
                     '9.27% of $8.99 revenue (90.73% pre-Stripe margin).'
 WHERE key = 'markup_multiple';

UPDATE billing_config
   SET value = 0.008333,
       description = 'Planning estimate AND cost ceiling for one standard '
                     'turn: $0.10 face price / 12x markup. Used for the spend '
                     'rollup before real token counts are backfilled. If the '
                     'realized blended cost exceeds this, raise '
                     'standard_turn_credits rather than eating the margin.'
 WHERE key = 'assumed_turn_cost_usd';

-- Documented for the pricing page and for whoever reads this table cold.
INSERT INTO billing_config (key, value, description, is_public) VALUES
  ('deep_dive_cost_budget_usd', 0.033333,
   'Real cost budget for one deep dive: $0.40 / 12x. A typical Sonnet turn '
   'measures ~$0.020 (inside budget); a heavy one ~$0.051 (over). Deep dives '
   'are the thinner-margin product -- watch them separately.', false),
  ('topup_pack_usd', 5,
   'One-time credit top-up pack size in user-facing dollars. 5000 credits, '
   '~$0.4167 of real spend at 12x -- same margin shape as the subscription.', true)
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- 2. Lifetime free-tier conversations
-- ===========================================================================
-- The free allowance no longer resets. That makes the durability of the
-- counter the whole design problem: it must survive
--
--   * signing out                  -> counter is server-side, not client-side
--   * clearing localStorage        -> ditto (signed-in path never reads it)
--   * deleting favorites           -> unrelated table
--   * deleting and recreating the  -> chat_lifetime_conversations has NO
--     account with the same login     foreign key to profiles, so the ON DELETE
--                                     CASCADE that removes a user's rows
--                                     everywhere else does not reach it, and
--                                     the key is derived from the login email
--                                     rather than from the (new) user id.
--
-- The key is a salted MD5 of the normalized email, not the email itself, so
-- this table is not a second copy of the user list. MD5 is used because it is
-- a core builtin (no pgcrypto dependency); the threat model here is
-- "don't store plaintext emails in a counter table", not "resist an adversary
-- who already has the salt".
--
-- PRIVACY TRADEOFF, stated plainly: surviving account deletion is the entire
-- point of this table and is in direct tension with an erasure request. On a
-- genuine erasure request the operator should DELETE the row and accept that
-- the person's free allowance resets. That is the correct order of priorities;
-- do not build an exception that keeps the row "just in case".

-- One-row salt table. RLS on with zero policies: service-role / SECURITY
-- DEFINER only. Rotating the salt orphans every existing counter, which resets
-- everyone's free allowance -- so do not rotate it casually.
CREATE TABLE IF NOT EXISTS chat_identity_salt (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  salt TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_identity_salt ENABLE ROW LEVEL SECURITY;

INSERT INTO chat_identity_salt (singleton, salt)
VALUES (true, gen_random_uuid()::TEXT || gen_random_uuid()::TEXT)
ON CONFLICT (singleton) DO NOTHING;

-- Durable identity for the lifetime counter.
--   'u:<hash>'   signed-in, keyed on the normalized login email
--   'uid:<uuid>' signed-in but no email on record (should not happen with
--                OAuth-only signup; degrades to per-account, i.e. resettable)
--   'a:<hash>'   signed out, keyed on the anon device hash -- NOT durable,
--                see docs/payment-model.md section 6.2
CREATE OR REPLACE FUNCTION chat_identity_key(
  p_user_id UUID,
  p_anon_key_hash TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_salt  TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    IF p_anon_key_hash IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN 'a:' || p_anon_key_hash;
  END IF;

  SELECT lower(trim(u.email)) INTO v_email FROM auth.users u WHERE u.id = p_user_id;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN 'uid:' || p_user_id::TEXT;
  END IF;

  SELECT s.salt INTO v_salt FROM chat_identity_salt s WHERE s.singleton;
  RETURN 'u:' || md5(v_email || COALESCE(v_salt, ''));
END;
$$;

REVOKE ALL ON FUNCTION chat_identity_key(UUID, TEXT) FROM anon, authenticated;

-- The counter itself. Monotone: only ever incremented. Never deleted by any
-- application path, never referenced by a foreign key.
CREATE TABLE IF NOT EXISTS chat_lifetime_conversations (
  identity_key TEXT PRIMARY KEY,
  -- 'user' | 'anon'. Informational; the key prefix already says it.
  scope TEXT NOT NULL DEFAULT 'user',
  conversations_started INTEGER NOT NULL DEFAULT 0
    CHECK (conversations_started >= 0),
  -- Support / goodwill escape hatch. chat_credit_grants covers credits; this
  -- covers conversations. Operator-set: "here, have three more".
  bonus_conversations INTEGER NOT NULL DEFAULT 0
    CHECK (bonus_conversations >= 0),
  first_conversation_at TIMESTAMP WITH TIME ZONE,
  last_conversation_at TIMESTAMP WITH TIME ZONE,
  -- Set when an anonymous counter has been folded into a signed-in one, so it
  -- can never be counted twice.
  absorbed_into TEXT,
  absorbed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- RLS on with zero policies. The user's own remaining count is exposed through
-- my_chat_entitlement (section 7), which is an owner-rights view -- the raw
-- table stays service-role only so nobody can enumerate identity keys.
ALTER TABLE chat_lifetime_conversations ENABLE ROW LEVEL SECURITY;

-- Plan-level lifetime allowance. NULL = not lifetime-gated.
-- Precedence in the gate: lifetime_conversations, if set, is the gate.
-- monthly_conversations / daily_conversations remain wired up so reverting to
-- a monthly allowance is an UPDATE, not a migration.
ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS lifetime_conversations INTEGER;

-- Free: 5 conversations, ever. 12 turns each -> a hard, permanent ceiling of
-- 60 turns (~$0.50 of real spend) per free user for the life of the account.
UPDATE billing_plans SET
  display_name           = 'Free',
  metering_mode          = 'conversations',
  lifetime_conversations = 5,
  monthly_conversations  = NULL,
  daily_conversations    = NULL,
  conversation_turn_cap  = 12,
  monthly_credits        = 0,
  daily_credits          = NULL,
  allow_deep_dive        = false,
  credit_allowance_usd   = 0,
  is_public              = true,
  sort_order             = 1
WHERE plan = 'free';

-- Signed out: 2 conversations, 8 turns. Lower than Free on purpose.
--
-- There is no durable identity for a signed-out visitor, so this number is a
-- speed bump and nothing else -- clearing localStorage mints a new identity.
-- Setting it BELOW the signed-in allowance means the cheapest way to get more
-- Bella is to sign in (free, and gives us an address to email), not to clear
-- storage. That is the only lever that actually works here. See
-- docs/payment-model.md section 6.2.
UPDATE billing_plans SET
  display_name           = 'Signed out',
  metering_mode          = 'conversations',
  lifetime_conversations = 2,
  monthly_conversations  = NULL,
  daily_conversations    = NULL,
  conversation_turn_cap  = 8,
  monthly_credits        = 0,
  daily_credits          = NULL,
  allow_deep_dive        = false,
  credit_allowance_usd   = 0,
  is_public              = false,
  sort_order             = 0
WHERE plan = 'anon';

-- Premium row, in case 20260821 has not been applied. Credit-metered, no
-- conversation gate of any kind.
INSERT INTO billing_plans (
  plan, display_name, monthly_credits, daily_credits, allow_deep_dive,
  price_cents_monthly, price_cents_yearly, price_cents_semiannual,
  metering_mode, monthly_conversations, daily_conversations,
  lifetime_conversations, conversation_turn_cap, credit_allowance_usd,
  includes_cabinet_memory, includes_checkin_emails, includes_surveys,
  includes_referrals, is_public, sort_order
) VALUES (
  'premium', 'Premium', 10000, NULL, true,
  899, 9168, 4854,
  'credits', NULL, NULL,
  NULL, NULL, 10.00,
  true, true, true,
  true, true, 3
)
ON CONFLICT (plan) DO UPDATE SET
  metering_mode          = 'credits',
  monthly_conversations  = NULL,
  daily_conversations    = NULL,
  lifetime_conversations = NULL,
  conversation_turn_cap  = NULL,
  monthly_credits        = EXCLUDED.monthly_credits,
  credit_allowance_usd   = EXCLUDED.credit_allowance_usd,
  allow_deep_dive        = true;
-- stripe_price_id_* deliberately absent from DO UPDATE: re-running must never
-- wipe ids written after the Stripe products were created.

-- Backfill the lifetime counter from any conversations that already exist,
-- once. Guarded by a marker so a re-run cannot double count.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM billing_config WHERE key = 'lifetime_backfill_rev') THEN
    INSERT INTO chat_lifetime_conversations (
      identity_key, scope, conversations_started,
      first_conversation_at, last_conversation_at
    )
    SELECT k.identity_key,
           CASE WHEN c.user_id IS NOT NULL THEN 'user' ELSE 'anon' END,
           COUNT(*)::INTEGER,
           MIN(c.started_at),
           MAX(c.started_at)
    FROM chat_conversations c
    CROSS JOIN LATERAL (
      SELECT chat_identity_key(c.user_id, c.anon_key_hash) AS identity_key
    ) k
    WHERE k.identity_key IS NOT NULL
    GROUP BY k.identity_key, (c.user_id IS NOT NULL)
    ON CONFLICT (identity_key) DO NOTHING;

    INSERT INTO billing_config (key, value, description, is_public)
    VALUES ('lifetime_backfill_rev', 1,
            'Marker: chat_lifetime_conversations has been seeded from '
            'pre-existing chat_conversations rows. Do not delete.', false);
  END IF;
END;
$$;

-- Fold an anonymous counter into the signed-in one, exactly once. Called by
-- the chat edge function on the first signed-in turn when the client still has
-- its pre-signup device id. Closes the cheap "use up anon, then sign in for
-- five more" path for honest users; someone who clears storage first is not
-- caught, and cannot be.
CREATE OR REPLACE FUNCTION chat_absorb_anon_identity(
  p_user_id UUID,
  p_anon_key_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_key TEXT;
  v_anon_key TEXT;
  v_n INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_anon_key_hash IS NULL THEN RETURN; END IF;

  v_user_key := chat_identity_key(p_user_id, NULL);
  v_anon_key := 'a:' || p_anon_key_hash;
  IF v_user_key IS NULL OR v_user_key = v_anon_key THEN RETURN; END IF;

  UPDATE chat_lifetime_conversations
     SET absorbed_into = v_user_key,
         absorbed_at   = NOW(),
         updated_at    = NOW()
   WHERE identity_key = v_anon_key
     AND absorbed_into IS NULL
  RETURNING conversations_started INTO v_n;

  IF v_n IS NULL OR v_n = 0 THEN RETURN; END IF;

  INSERT INTO chat_lifetime_conversations AS l (
    identity_key, scope, conversations_started, last_conversation_at
  )
  VALUES (v_user_key, 'user', v_n, NOW())
  ON CONFLICT (identity_key) DO UPDATE SET
    conversations_started = l.conversations_started + EXCLUDED.conversations_started,
    updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION chat_absorb_anon_identity(UUID, TEXT) FROM anon, authenticated;

-- ===========================================================================
-- 3. Region policy catalog
-- ===========================================================================
-- Policy is DATA. There is no country code anywhere in application code; the
-- only thing code knows is the three policy names.
--
--   always_on      Check-in emails default ON. Premium offered normally.
--   consent_first  Check-in emails default OFF until an explicit affirmative
--                  consent event is recorded. Premium still offered.
--   avoid          Premium is not offered at all. The app still works for
--                  free browsing, favorites, sharing and the free chat tier.
--
-- Adding, moving or removing a country is an UPDATE against this table. The
-- fallback row for an unknown or unresolved country is 'ZZ' (an ISO 3166-1
-- user-assigned code, so it can never collide with a real one), seeded to
-- consent_first -- the safe default is "sell, but do not email without asking".

CREATE TABLE IF NOT EXISTS billing_region_policy (
  country_code CHAR(2) PRIMARY KEY,
  region_label TEXT,
  policy TEXT NOT NULL
    CHECK (policy IN ('always_on', 'consent_first', 'avoid')),
  -- Denormalized so the app never has to re-derive policy semantics.
  sell_premium BOOLEAN NOT NULL,
  marketing_default_opt_in BOOLEAN NOT NULL,
  rationale TEXT,
  -- 'unreviewed' | 'reviewed' | 'needs_review'. Seeded 'unreviewed'.
  legal_review_status TEXT NOT NULL DEFAULT 'unreviewed',
  reviewed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- The three tiers have fixed implications; the CHECK stops a typo from
  -- creating an incoherent row like "avoid but sell anyway".
  CONSTRAINT billing_region_policy_coherent CHECK (
    (policy = 'always_on'     AND sell_premium AND marketing_default_opt_in)
    OR (policy = 'consent_first' AND sell_premium AND NOT marketing_default_opt_in)
    OR (policy = 'avoid'         AND NOT sell_premium AND NOT marketing_default_opt_in)
  )
);

CREATE INDEX IF NOT EXISTS idx_billing_region_policy_policy
  ON billing_region_policy (policy);

-- RLS on with zero policies: the raw table (including the avoid list and the
-- rationales) is service-role only. Clients get exactly one answer at a time
-- through region_policy_for_country() in section 4.
ALTER TABLE billing_region_policy ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS billing_region_policy_updated_at ON billing_region_policy;
CREATE TRIGGER billing_region_policy_updated_at
  BEFORE UPDATE ON billing_region_policy
  FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();

-- --- Seed ------------------------------------------------------------------
-- ON CONFLICT DO NOTHING throughout: once the owner has corrected a row, a
-- re-run of this migration must not stomp it.
--
-- ⚠️ NOT LEGAL ADVICE. Every row below is seeded legal_review_status =
-- 'unreviewed'. The groupings are an engineer's reading of widely-summarized
-- regimes (GDPR/ePrivacy, UK PECR, Canada CASL, Australia Spam Act, and the
-- US comprehensive sanctions programs) and are a starting point for review,
-- not a conclusion.

-- always_on: the owner's home market only.
INSERT INTO billing_region_policy
  (country_code, region_label, policy, sell_premium, marketing_default_opt_in, rationale)
VALUES
  ('US', 'United States', 'always_on', true, true,
   'Home market. CAN-SPAM is an opt-out regime for commercial email; check-ins '
   'default on with one-click unsubscribe on every send. Sales tax on SaaS '
   'varies by state -- Stripe Tax handles calculation.')
ON CONFLICT (country_code) DO NOTHING;

-- consent_first: opt-in marketing regimes.
INSERT INTO billing_region_policy
  (country_code, region_label, policy, sell_premium, marketing_default_opt_in, rationale)
VALUES
  -- EU / EEA
  ('AT','Austria','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('BE','Belgium','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('BG','Bulgaria','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('HR','Croatia','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('CY','Cyprus','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('CZ','Czechia','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('DK','Denmark','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('EE','Estonia','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('FI','Finland','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('FR','France','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('DE','Germany','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('GR','Greece','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('HU','Hungary','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('IE','Ireland','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('IT','Italy','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('LV','Latvia','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('LT','Lithuania','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('LU','Luxembourg','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('MT','Malta','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('NL','Netherlands','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('PL','Poland','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('PT','Portugal','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('RO','Romania','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('SK','Slovakia','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('SI','Slovenia','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('ES','Spain','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('SE','Sweden','consent_first',true,false,'EU: GDPR + ePrivacy opt-in.'),
  ('IS','Iceland','consent_first',true,false,'EEA: GDPR applies.'),
  ('LI','Liechtenstein','consent_first',true,false,'EEA: GDPR applies.'),
  ('NO','Norway','consent_first',true,false,'EEA: GDPR applies.'),
  -- Other opt-in regimes
  ('GB','United Kingdom','consent_first',true,false,'UK GDPR + PECR opt-in.'),
  ('CH','Switzerland','consent_first',true,false,
   'Revised FADP; unsolicited commercial email restricted. Treated as opt-in.'),
  ('CA','Canada','consent_first',true,false,
   'CASL requires express or clearly-scoped implied consent, with records.'),
  ('AU','Australia','consent_first',true,false,'Spam Act 2003: consent-based.'),
  ('NZ','New Zealand','consent_first',true,false,
   'Unsolicited Electronic Messages Act: consent-based.'),
  ('SG','Singapore','consent_first',true,false,'PDPA / DNC provisions.'),
  ('JP','Japan','consent_first',true,false,
   'Act on Regulation of Transmission of Specified Electronic Mail: opt-in.'),
  ('KR','South Korea','consent_first',true,false,
   'Network Act: prior consent required, with periodic reconfirmation.'),
  ('BR','Brazil','consent_first',true,false,'LGPD.'),
  ('IN','India','consent_first',true,false,
   'DPDP Act is consent-based. SEPARATE OWNER DECISION: RBI e-mandate rules '
   'make recurring card subscriptions operationally painful -- if that proves '
   'true in practice, move this row to avoid with an UPDATE.'),
  ('ZA','South Africa','consent_first',true,false,'POPIA.'),
  ('MX','Mexico','consent_first',true,false,'LFPDPPP.'),
  -- Fallback row for an unknown / unresolved country.
  ('ZZ','Unknown / unresolved','consent_first',true,false,
   'FALLBACK ROW. Used when no country can be resolved for a user. Sells, but '
   'never defaults email on. Do not delete this row -- the resolver depends '
   'on it existing.')
ON CONFLICT (country_code) DO NOTHING;

-- avoid: comprehensive US sanctions programs. Stripe will not onboard these
-- anyway; the rows exist so the app refuses before Stripe does and so the
-- decision is visible in one place.
--
-- ⚠️ KNOWN GAP: sanctions also apply to sub-national regions (Crimea, Donetsk,
-- Luhansk, Kherson, Zaporizhzhia) which a two-letter country code cannot
-- express. Those resolve to 'UA', which is not seeded and therefore falls
-- through to the 'ZZ' fallback and SELLS. Accepted for now on the basis that
-- Stripe's own screening is the backstop; revisit before marketing in Ukraine.
INSERT INTO billing_region_policy
  (country_code, region_label, policy, sell_premium, marketing_default_opt_in, rationale)
VALUES
  ('CU','Cuba','avoid',false,false,'US comprehensive sanctions program.'),
  ('IR','Iran','avoid',false,false,'US comprehensive sanctions program.'),
  ('KP','North Korea','avoid',false,false,'US comprehensive sanctions program.'),
  ('SY','Syria','avoid',false,false,'US comprehensive sanctions program.'),
  ('RU','Russia','avoid',false,false,'Broad US/EU/UK sanctions; payment rails unreliable.'),
  ('BY','Belarus','avoid',false,false,'Broad US/EU/UK sanctions.'),
  ('AF','Afghanistan','avoid',false,false,'Sanctions exposure; payment rails unreliable.'),
  ('MM','Myanmar','avoid',false,false,'Sanctions exposure.'),
  ('VE','Venezuela','avoid',false,false,'Partial sanctions; conservative default.'),
  ('SD','Sudan','avoid',false,false,'Sanctions exposure.')
ON CONFLICT (country_code) DO NOTHING;

-- ===========================================================================
-- 4. Per-user region resolution
-- ===========================================================================
-- Two sources of truth, for two different questions.
--
--   billing_country   AUTHORITATIVE, from Stripe (the billing address collected
--                     at Checkout, mirrored onto the Customer). This is the
--                     only country that has any business deciding whether we
--                     sell, or how tax is treated. It does not exist until
--                     someone reaches Checkout.
--
--   declared_country  WEAK, pre-checkout. A CDN geo header (cf-ipcountry and
--                     friends) if the edge gave us one, otherwise a country
--                     the user picked, otherwise an Accept-Language guess.
--                     Good enough to decide what UI to render and to pick a
--                     conservative email default. Not good enough to be a
--                     control -- a VPN defeats it and a client can lie.
--
--   override_country  Operator escape hatch, beats both. For the VPN false
--                     positive and for the support case Stripe got wrong.
--
-- Precedence: override > billing > declared > 'ZZ'.
--
-- WHEN THEY DISAGREE:
--   * Selling: the authoritative source wins, EXCEPT that if EITHER source
--     says 'avoid' we do not sell. The cost of a wrong block is a support
--     email; the cost of a wrong sale into a sanctioned country is not
--     symmetric with that. override_country exists to unblock the false
--     positives.
--   * Email: ratchet toward the stricter side. marketing_default_opt_in is the
--     AND of both sources, so a user who looks EU from either angle is never
--     defaulted on. Critically, a LATER resolution to always_on does NOT
--     retroactively opt anyone in -- it only changes the default for people
--     who have not been asked yet. Silently flipping an existing user to
--     opted-in because their country resolution moved is precisely the thing
--     that reads badly in an audit.

CREATE TABLE IF NOT EXISTS billing_user_region (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  billing_country CHAR(2),
  -- 'stripe_checkout' | 'stripe_customer' | 'manual'
  billing_country_source TEXT,
  billing_country_set_at TIMESTAMP WITH TIME ZONE,
  declared_country CHAR(2),
  -- 'geo_header' | 'user_selected' | 'accept_language'
  declared_country_source TEXT,
  declared_country_set_at TIMESTAMP WITH TIME ZONE,
  override_country CHAR(2),
  override_reason TEXT,
  override_set_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_user_region ENABLE ROW LEVEL SECURITY;

-- Owner may read their own row; every write goes through the SECURITY DEFINER
-- functions below or the service role (the Stripe webhook).
DROP POLICY IF EXISTS "Users can view their own region" ON billing_user_region;
CREATE POLICY "Users can view their own region"
  ON billing_user_region FOR SELECT
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS billing_user_region_updated_at ON billing_user_region;
CREATE TRIGGER billing_user_region_updated_at
  BEFORE UPDATE ON billing_user_region
  FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();

-- Single-country lookup, safe to expose. Returns the fallback row's answer for
-- an unknown code, so it never returns zero rows.
CREATE OR REPLACE FUNCTION region_policy_for_country(p_country TEXT)
RETURNS TABLE (
  country_code CHAR(2),
  policy TEXT,
  sell_premium BOOLEAN,
  marketing_default_opt_in BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.country_code, r.policy, r.sell_premium, r.marketing_default_opt_in
  FROM billing_region_policy r
  WHERE r.country_code = upper(NULLIF(trim(COALESCE(p_country, '')), ''))
  UNION ALL
  SELECT r.country_code, r.policy, r.sell_premium, r.marketing_default_opt_in
  FROM billing_region_policy r
  WHERE r.country_code = 'ZZ'
    AND NOT EXISTS (
      SELECT 1 FROM billing_region_policy x
      WHERE x.country_code = upper(NULLIF(trim(COALESCE(p_country, '')), ''))
    )
  LIMIT 1;
$$;

-- UX-only: lets a signed-out client render the right pricing UI from a geo
-- guess. Not a control -- create-checkout-session re-resolves server-side.
GRANT EXECUTE ON FUNCTION region_policy_for_country(TEXT) TO anon, authenticated;

-- The resolved answer for one user, implementing the precedence and the
-- disagreement rules above.
CREATE OR REPLACE FUNCTION billing_region_for_user(p_user_id UUID)
RETURNS TABLE (
  country CHAR(2),
  country_source TEXT,
  policy TEXT,
  sell_premium BOOLEAN,
  marketing_default_opt_in BOOLEAN,
  conflicted BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg billing_user_region%ROWTYPE;
  v_primary CHAR(2);
  v_source TEXT;
  v_main RECORD;
  v_decl RECORD;
BEGIN
  SELECT * INTO v_reg FROM billing_user_region WHERE user_id = p_user_id;

  IF v_reg.override_country IS NOT NULL THEN
    v_primary := v_reg.override_country; v_source := 'override';
  ELSIF v_reg.billing_country IS NOT NULL THEN
    v_primary := v_reg.billing_country;
    v_source  := COALESCE(v_reg.billing_country_source, 'stripe');
  ELSIF v_reg.declared_country IS NOT NULL THEN
    v_primary := v_reg.declared_country;
    v_source  := COALESCE(v_reg.declared_country_source, 'declared');
  ELSE
    v_primary := 'ZZ'; v_source := 'unresolved';
  END IF;

  SELECT * INTO v_main FROM region_policy_for_country(v_primary);
  SELECT * INTO v_decl FROM region_policy_for_country(
    COALESCE(v_reg.declared_country, v_primary)
  );

  RETURN QUERY SELECT
    v_primary,
    v_source,
    -- An 'avoid' from EITHER angle wins; otherwise the primary source decides.
    CASE
      WHEN v_reg.override_country IS NOT NULL THEN v_main.policy
      WHEN v_main.policy = 'avoid' OR v_decl.policy = 'avoid' THEN 'avoid'
      ELSE v_main.policy
    END,
    CASE
      WHEN v_reg.override_country IS NOT NULL THEN v_main.sell_premium
      ELSE (v_main.sell_premium AND v_decl.sell_premium)
    END,
    -- Ratchet toward the stricter email default.
    CASE
      WHEN v_reg.override_country IS NOT NULL THEN v_main.marketing_default_opt_in
      ELSE (v_main.marketing_default_opt_in AND v_decl.marketing_default_opt_in)
    END,
    (v_reg.billing_country IS NOT NULL
     AND v_reg.declared_country IS NOT NULL
     AND v_reg.billing_country <> v_reg.declared_country
     AND v_main.policy IS DISTINCT FROM v_decl.policy);
END;
$$;

REVOKE ALL ON FUNCTION billing_region_for_user(UUID) FROM anon, authenticated;

-- Client-callable: record a weak, pre-checkout country guess. Can only ever
-- write declared_country for the caller; can never touch billing_country or
-- override_country, so a lying client cannot unblock an 'avoid' region (the
-- 'avoid'-from-either-source rule in billing_region_for_user means a false
-- declaration can only ever make things stricter, never looser).
CREATE OR REPLACE FUNCTION set_my_declared_country(
  p_country TEXT,
  p_source TEXT DEFAULT 'user_selected'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country CHAR(2);
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  v_country := upper(NULLIF(trim(COALESCE(p_country, '')), ''));
  IF v_country IS NULL OR length(v_country) <> 2 THEN
    RAISE EXCEPTION 'p_country must be a 2-letter ISO 3166-1 alpha-2 code';
  END IF;

  INSERT INTO billing_user_region AS r (
    user_id, declared_country, declared_country_source, declared_country_set_at
  )
  VALUES (
    auth.uid(), v_country,
    CASE WHEN p_source IN ('geo_header','user_selected','accept_language')
         THEN p_source ELSE 'user_selected' END,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    declared_country        = EXCLUDED.declared_country,
    declared_country_source = EXCLUDED.declared_country_source,
    declared_country_set_at = NOW(),
    updated_at              = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION set_my_declared_country(TEXT, TEXT) TO authenticated;

-- Service-role only twin of set_my_declared_country(), for the edge functions,
-- which act with the service role and therefore have no auth.uid(). Writes
-- ONLY declared_country -- there is deliberately no service-role path that
-- lets a request-time signal masquerade as the Stripe-collected country.
CREATE OR REPLACE FUNCTION set_declared_country(
  p_user_id UUID,
  p_country TEXT,
  p_source TEXT DEFAULT 'geo_header'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country CHAR(2);
BEGIN
  v_country := upper(NULLIF(trim(COALESCE(p_country, '')), ''));
  IF p_user_id IS NULL OR v_country IS NULL OR length(v_country) <> 2 THEN
    RETURN;
  END IF;

  INSERT INTO billing_user_region AS r (
    user_id, declared_country, declared_country_source, declared_country_set_at
  )
  VALUES (
    p_user_id, v_country,
    CASE WHEN p_source IN ('geo_header','user_selected','accept_language')
         THEN p_source ELSE 'geo_header' END,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    declared_country        = EXCLUDED.declared_country,
    declared_country_source = EXCLUDED.declared_country_source,
    declared_country_set_at = NOW(),
    updated_at              = NOW();
END;
$$;

REVOKE ALL ON FUNCTION set_declared_country(UUID, TEXT, TEXT) FROM anon, authenticated;

-- Service-role only: the Stripe webhook writes the authoritative country here
-- from the Checkout Session's collected billing address.
CREATE OR REPLACE FUNCTION set_billing_country(
  p_user_id UUID,
  p_country TEXT,
  p_source TEXT DEFAULT 'stripe_checkout'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country CHAR(2);
BEGIN
  v_country := upper(NULLIF(trim(COALESCE(p_country, '')), ''));
  IF p_user_id IS NULL OR v_country IS NULL OR length(v_country) <> 2 THEN
    RETURN;
  END IF;

  INSERT INTO billing_user_region AS r (
    user_id, billing_country, billing_country_source, billing_country_set_at
  )
  VALUES (p_user_id, v_country, p_source, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    billing_country        = EXCLUDED.billing_country,
    billing_country_source = EXCLUDED.billing_country_source,
    billing_country_set_at = NOW(),
    updated_at             = NOW();
END;
$$;

REVOKE ALL ON FUNCTION set_billing_country(UUID, TEXT, TEXT) FROM anon, authenticated;

-- A subscription that completed from an 'avoid' country despite the
-- pre-checkout block. Flagged rather than auto-cancelled: entitlement is left
-- intact (they paid and the product works) and a human refunds and cancels.
-- Auto-revoking paid access on a webhook is a worse failure than a flag.
ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS region_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS region_blocked_reason TEXT;

-- Operator queue. RLS on with zero policies; read it from the dashboard.
CREATE OR REPLACE VIEW billing_region_review AS
SELECT
  s.id AS subscription_id,
  s.user_id,
  s.stripe_subscription_id,
  s.status,
  s.region_blocked,
  s.region_blocked_reason,
  r.billing_country,
  r.declared_country,
  r.override_country,
  reg.policy,
  reg.conflicted
FROM billing_subscriptions s
LEFT JOIN billing_user_region r ON r.user_id = s.user_id
CROSS JOIN LATERAL billing_region_for_user(s.user_id) reg
WHERE s.region_blocked OR reg.policy = 'avoid' OR reg.conflicted;

REVOKE ALL ON billing_region_review FROM anon, authenticated;

-- ===========================================================================
-- 5. Email consent
-- ===========================================================================
-- The thing that matters if we are ever asked to prove consent is not a
-- boolean -- it is WHEN, HOW, and WHAT WORDING was shown. So consent is an
-- append-only event log; the boolean on profiles is a cache of the latest
-- event, never the record of it.

CREATE TABLE IF NOT EXISTS email_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Which stream of email. 'checkin_email' is the only one today.
  channel TEXT NOT NULL DEFAULT 'checkin_email',
  action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  -- HOW it was given. 'unsubscribe_link' and 'email_link' are token-based and
  -- arrive without a session, so they are written by the bella-survey /
  -- unsubscribe function with the service role.
  method TEXT NOT NULL CHECK (method IN (
    'signup_checkbox', 'settings_toggle', 'checkout_checkbox',
    'unsubscribe_link', 'email_link', 'import', 'operator'
  )),
  -- The EXACT wording shown next to the control the user acted on. This is the
  -- single most important column in the table; a consent record that cannot
  -- reproduce what the person agreed to is not much of a record.
  consent_text TEXT,
  consent_version TEXT,
  -- The region policy and country in force at the moment of the event, frozen
  -- here so a later policy edit cannot rewrite history.
  policy_at_time TEXT,
  country_at_time CHAR(2),
  ip_hash TEXT,
  user_agent TEXT,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_consent_events_user
  ON email_consent_events (user_id, channel, occurred_at DESC);

ALTER TABLE email_consent_events ENABLE ROW LEVEL SECURITY;

-- Users may read their own consent history (a "you agreed on X" line in
-- Settings is good practice). No INSERT/UPDATE/DELETE policy: the log is
-- append-only through record_email_consent() and immutable thereafter.
DROP POLICY IF EXISTS "Users can view their own consent events" ON email_consent_events;
CREATE POLICY "Users can view their own consent events"
  ON email_consent_events FOR SELECT
  USING (auth.uid() = user_id);

-- Latest consent state per (user, channel).
CREATE OR REPLACE FUNCTION email_consent_state(
  p_user_id UUID,
  p_channel TEXT DEFAULT 'checkin_email'
)
RETURNS TABLE (action TEXT, occurred_at TIMESTAMP WITH TIME ZONE, method TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.action, e.occurred_at, e.method
  FROM email_consent_events e
  WHERE e.user_id = p_user_id AND e.channel = p_channel
  ORDER BY e.occurred_at DESC, e.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION email_consent_state(UUID, TEXT) FROM anon, authenticated;

-- Client-callable. user_id, policy_at_time and country_at_time are stamped
-- server-side from the session and the resolver -- the client supplies only
-- what it legitimately knows: which way, by what control, and with what
-- wording on screen.
CREATE OR REPLACE FUNCTION record_email_consent(
  p_action TEXT,
  p_method TEXT,
  p_consent_text TEXT DEFAULT NULL,
  p_consent_version TEXT DEFAULT NULL,
  p_channel TEXT DEFAULT 'checkin_email'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_reg RECORD;
  v_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'sign in to change email preferences';
  END IF;
  IF p_action NOT IN ('granted', 'withdrawn') THEN
    RAISE EXCEPTION 'p_action must be granted or withdrawn';
  END IF;
  -- Only the in-app methods are reachable with a session. Token-based methods
  -- come in without one and are written by the service role instead.
  IF p_method NOT IN ('signup_checkbox', 'settings_toggle', 'checkout_checkbox') THEN
    RAISE EXCEPTION 'p_method must be one of signup_checkbox, settings_toggle, checkout_checkbox';
  END IF;

  SELECT * INTO v_reg FROM billing_region_for_user(v_user);

  INSERT INTO email_consent_events (
    user_id, channel, action, method, consent_text, consent_version,
    policy_at_time, country_at_time
  )
  VALUES (
    v_user, p_channel, p_action, p_method,
    left(COALESCE(p_consent_text, ''), 2000), p_consent_version,
    v_reg.policy, v_reg.country
  )
  RETURNING id INTO v_id;

  -- Keep the profiles cache in step, if 20260823 has been applied. Written
  -- through to_jsonb/dynamic SQL so this file works whether or not that
  -- migration exists yet.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'checkin_emails_enabled'
  ) AND p_channel = 'checkin_email' THEN
    EXECUTE 'UPDATE profiles SET checkin_emails_enabled = $1 WHERE id = $2'
      USING (p_action = 'granted'), v_user;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION record_email_consent(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

-- THE function the check-in cron must gate on, replacing a bare
-- `profiles.checkin_emails_enabled` test.
--
-- Order of precedence:
--   1. An explicit 'withdrawn' event always wins. Unsubscribe is absolute.
--   2. profiles.checkin_emails_enabled = FALSE always wins (a user who turned
--      it off in Settings before this migration existed).
--   3. always_on region  -> allowed unless (1) or (2).
--   4. anything else (consent_first, avoid, unresolved) -> allowed ONLY with a
--      recorded 'granted' event.
--
-- Reads profiles through to_jsonb so it does not hard-depend on
-- 20260823_bella_memory.sql having been applied; when the column is absent it
-- is simply treated as "not explicitly disabled".
CREATE OR REPLACE FUNCTION dermodel_checkin_emails_allowed(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag JSONB;
  v_enabled BOOLEAN;
  v_consent RECORD;
  v_reg RECORD;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  -- to_jsonb() rather than a direct column reference, so this compiles and
  -- runs whether or not 20260823_bella_memory.sql has been applied.
  SELECT to_jsonb(p) INTO v_flag FROM profiles p WHERE p.id = p_user_id;
  IF v_flag IS NULL THEN RETURN false; END IF;   -- no such profile
  v_enabled := CASE
    WHEN jsonb_typeof(v_flag -> 'checkin_emails_enabled') = 'boolean'
    THEN (v_flag ->> 'checkin_emails_enabled')::BOOLEAN
    ELSE NULL                                    -- absent, or explicitly NULL
  END;

  SELECT * INTO v_consent FROM email_consent_state(p_user_id, 'checkin_email');

  -- 1. Explicit withdrawal is absolute.
  IF v_consent.action = 'withdrawn' THEN RETURN false; END IF;
  -- 2. Explicit off in Settings.
  IF v_enabled IS FALSE THEN RETURN false; END IF;
  -- 3. Explicit grant is sufficient everywhere.
  IF v_consent.action = 'granted' THEN RETURN true; END IF;

  -- 4. No consent event: fall back to the region default.
  SELECT * INTO v_reg FROM billing_region_for_user(p_user_id);
  RETURN COALESCE(v_reg.marketing_default_opt_in, false);
END;
$$;

REVOKE ALL ON FUNCTION dermodel_checkin_emails_allowed(UUID) FROM anon, authenticated;

-- --- Reconciling profiles.checkin_emails_enabled ---------------------------
-- 20260823_bella_memory.sql adds that column NOT NULL DEFAULT TRUE, which is
-- the wrong default for a consent_first region. The owner of that file makes
-- the source change (see docs/payment-model.md section 8.4); what this block
-- does is make the LIVE column three-valued so "never asked" is expressible:
--
--     TRUE  = explicitly on
--     FALSE = explicitly off
--     NULL  = never asked -> defer to dermodel_checkin_emails_allowed()
--
-- Guarded twice: only runs if the column exists, and only clears existing
-- TRUEs if no consent event has ever been recorded (i.e. nobody has answered
-- the question yet, which is the state this ships in). If consent events
-- already exist, the default and NOT NULL are still relaxed but existing
-- values are left alone -- a human must then decide what those TRUEs meant.
DO $$
DECLARE
  v_has_col BOOLEAN;
  v_has_consent BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'checkin_emails_enabled'
  ) INTO v_has_col;

  IF NOT v_has_col THEN
    RAISE NOTICE '20260824: profiles.checkin_emails_enabled not present yet; '
                 'apply 20260823_bella_memory.sql then re-run this migration '
                 'to relax its default.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE profiles ALTER COLUMN checkin_emails_enabled DROP DEFAULT';
  BEGIN
    EXECUTE 'ALTER TABLE profiles ALTER COLUMN checkin_emails_enabled DROP NOT NULL';
  EXCEPTION WHEN others THEN
    NULL;  -- already nullable
  END;

  SELECT EXISTS (SELECT 1 FROM email_consent_events) INTO v_has_consent;
  IF NOT v_has_consent THEN
    EXECUTE 'UPDATE profiles SET checkin_emails_enabled = NULL '
            'WHERE checkin_emails_enabled IS TRUE';
  ELSE
    RAISE NOTICE '20260824: consent events already exist; leaving existing '
                 'checkin_emails_enabled values untouched. Review them by hand.';
  END IF;
END;
$$;

-- ===========================================================================
-- 6. Entitlement view
-- ===========================================================================
-- Column set changed, so DROP + CREATE. This is THE read the frontend makes;
-- see the integration contract at the end of docs/payment-model.md. Names in
-- here are a contract -- do not rename without telling whoever owns src/.

DROP VIEW IF EXISTS my_chat_entitlement;

CREATE VIEW my_chat_entitlement AS
SELECT
  u.id AS user_id,
  pl.plan,
  pl.display_name,
  pl.metering_mode,

  -- --- Conversation allowance ---------------------------------------------
  CASE
    WHEN pl.metering_mode <> 'conversations' THEN 'none'
    WHEN pl.lifetime_conversations IS NOT NULL THEN 'lifetime'
    WHEN pl.monthly_conversations IS NOT NULL THEN 'monthly'
    ELSE 'none'
  END AS conversation_allowance_scope,
  pl.lifetime_conversations,
  pl.monthly_conversations,
  pl.conversation_turn_cap,
  COALESCE(life.conversations_started, 0)::INTEGER AS conversations_used_lifetime,
  COALESCE(life.bonus_conversations, 0)::INTEGER AS bonus_conversations,
  CASE
    WHEN pl.lifetime_conversations IS NULL THEN NULL
    ELSE GREATEST(
      pl.lifetime_conversations + COALESCE(life.bonus_conversations, 0)
        - COALESCE(life.conversations_started, 0),
      0
    )::INTEGER
  END AS conversations_remaining_lifetime,
  COALESCE(conv_month.n, 0)::INTEGER AS conversations_used_this_month,
  CASE
    WHEN pl.monthly_conversations IS NULL THEN NULL
    ELSE GREATEST(pl.monthly_conversations - COALESCE(conv_month.n, 0), 0)::INTEGER
  END AS conversations_remaining_this_month,

  -- --- Credit allowance ----------------------------------------------------
  pl.monthly_credits,
  pl.credit_allowance_usd,
  pl.allow_deep_dive,
  COALESCE(month.used, 0)::INTEGER AS credits_used_this_month,
  COALESCE(grants.credits, 0)::INTEGER AS bonus_credits,
  GREATEST(
    pl.monthly_credits + COALESCE(grants.credits, 0) - COALESCE(month.used, 0), 0
  )::INTEGER AS credits_remaining_this_month,
  ROUND(
    GREATEST(
      pl.monthly_credits + COALESCE(grants.credits, 0) - COALESCE(month.used, 0), 0
    ) * billing_config_num('credit_unit_usd', 0.001),
    2
  ) AS credit_usd_remaining_this_month,

  -- --- What the plan sells -------------------------------------------------
  pl.includes_cabinet_memory,
  pl.includes_checkin_emails,
  pl.includes_surveys,
  pl.includes_referrals,

  -- --- Region + consent ----------------------------------------------------
  reg.policy AS region_policy,
  reg.country AS region_country,
  reg.country_source AS region_country_source,
  reg.sell_premium,
  dermodel_checkin_emails_allowed(u.id) AS checkin_emails_effective,
  -- TRUE when the UI should ASK. Only worth asking where the default is off
  -- and the question has not been answered either way.
  (NOT reg.marketing_default_opt_in
   AND consent.action IS NULL
   AND reg.policy <> 'avoid') AS checkin_email_consent_required,
  consent.action AS checkin_email_consent_action,
  consent.occurred_at AS checkin_email_consent_at,

  -- --- Upgrade prompt ------------------------------------------------------
  -- 'none' | 'soft' (one conversation left -- warn now, because there is no
  -- monthly reset to fall back on) | 'hard' (out).
  CASE
    WHEN NOT reg.sell_premium THEN 'none'
    WHEN pl.metering_mode <> 'conversations' THEN 'none'
    WHEN pl.lifetime_conversations IS NULL THEN 'none'
    WHEN GREATEST(
           pl.lifetime_conversations + COALESCE(life.bonus_conversations, 0)
             - COALESCE(life.conversations_started, 0), 0) = 0 THEN 'hard'
    WHEN GREATEST(
           pl.lifetime_conversations + COALESCE(life.bonus_conversations, 0)
             - COALESCE(life.conversations_started, 0), 0) <= 1 THEN 'soft'
    ELSE 'none'
  END AS upgrade_prompt,

  -- --- Subscription state --------------------------------------------------
  sub.status AS subscription_status,
  sub.current_period_end,
  sub.cancel_at_period_end
FROM auth.users u
CROSS JOIN LATERAL (
  SELECT * FROM billing_plans WHERE plan = billing_plan_for_user(u.id)
) pl
CROSS JOIN LATERAL billing_region_for_user(u.id) reg
LEFT JOIN LATERAL (
  SELECT * FROM chat_lifetime_conversations l
  WHERE l.identity_key = chat_identity_key(u.id, NULL)
) life ON true
LEFT JOIN LATERAL (
  SELECT * FROM email_consent_state(u.id, 'checkin_email')
) consent ON true
LEFT JOIN LATERAL (
  SELECT SUM(credits) AS used
  FROM chat_usage_events e
  WHERE e.user_id = u.id AND e.created_at >= date_trunc('month', NOW())
) month ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS n
  FROM chat_conversations c
  WHERE c.user_id = u.id AND c.started_at >= date_trunc('month', NOW())
) conv_month ON true
LEFT JOIN LATERAL (
  SELECT SUM(credits) AS credits
  FROM chat_credit_grants g
  WHERE g.user_id = u.id AND (g.expires_at IS NULL OR g.expires_at > NOW())
) grants ON true
LEFT JOIN LATERAL (
  SELECT status, current_period_end, cancel_at_period_end
  FROM billing_subscriptions s
  WHERE s.user_id = u.id AND s.status IN ('trialing', 'active', 'past_due')
  ORDER BY s.created_at DESC
  LIMIT 1
) sub ON true
WHERE u.id = auth.uid();

GRANT SELECT ON my_chat_entitlement TO authenticated;

-- Public plan catalog. Adds lifetime_conversations so a pricing page can say
-- "5 free chats" without implying a monthly reset.
DROP VIEW IF EXISTS billing_plans_public;

CREATE VIEW billing_plans_public AS
SELECT
  plan,
  display_name,
  price_cents_monthly,
  price_cents_semiannual,
  price_cents_yearly,
  credit_allowance_usd,
  lifetime_conversations,
  monthly_conversations,
  conversation_turn_cap,
  allow_deep_dive,
  includes_cabinet_memory,
  includes_checkin_emails,
  includes_surveys,
  includes_referrals,
  sort_order
FROM billing_plans
WHERE is_public
ORDER BY sort_order;

GRANT SELECT ON billing_plans_public TO anon, authenticated;

-- ===========================================================================
-- 7. The gate
-- ===========================================================================
-- Adds the lifetime path and one OUT column, so DROP + CREATE (the argument
-- list is unchanged; CREATE OR REPLACE cannot change OUT columns).
--
-- reason values:
--   ok
--   deep_dive_requires_premium
--   conversation_turn_limit        -- this chat is full; start a new one
--   lifetime_conversation_limit    -- out of free chats, permanently  <-- NEW
--   monthly_conversation_limit     -- only if a plan is monthly-gated
--   daily_conversation_limit
--   monthly_credit_limit
--   free_tier_budget_exhausted
--   chat_not_available

DROP FUNCTION IF EXISTS consume_chat_turn(UUID, TEXT, UUID, TEXT, BOOLEAN, INTEGER);

CREATE FUNCTION consume_chat_turn(
  p_user_id UUID,
  p_anon_key_hash TEXT,
  p_conversation_id UUID,
  p_model TEXT,
  p_deep_dive BOOLEAN DEFAULT false,
  p_credits INTEGER DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  plan TEXT,
  conversation_id UUID,
  conversation_started BOOLEAN,
  turns_remaining_in_conversation INTEGER,
  conversations_remaining INTEGER,
  conversations_remaining_lifetime INTEGER,
  credits_remaining INTEGER,
  credit_usd_remaining NUMERIC,
  reason TEXT,
  usage_event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_row billing_plans%ROWTYPE;
  v_credits INTEGER;
  v_conv chat_conversations%ROWTYPE;
  v_new_conv BOOLEAN := false;
  v_conv_month INTEGER := 0;
  v_conv_day INTEGER := 0;
  v_conv_left INTEGER;
  v_turns_left INTEGER;
  v_ident TEXT;
  v_life_used INTEGER := 0;
  v_life_bonus INTEGER := 0;
  v_life_left INTEGER;
  v_bonus INTEGER := 0;
  v_month_used INTEGER := 0;
  v_allowance INTEGER := 0;
  v_remaining INTEGER := 0;
  v_idle_minutes NUMERIC;
  v_max_age_hours NUMERIC;
  v_unit NUMERIC;
  v_assumed NUMERIC;
  v_cap NUMERIC;
  v_spent NUMERIC;
  v_event_id UUID;
  v_period DATE := date_trunc('month', NOW())::DATE;
BEGIN
  IF (p_user_id IS NULL) = (p_anon_key_hash IS NULL) THEN
    RAISE EXCEPTION 'exactly one of p_user_id / p_anon_key_hash is required';
  END IF;

  v_plan := CASE WHEN p_user_id IS NULL
                 THEN 'anon' ELSE billing_plan_for_user(p_user_id) END;
  SELECT * INTO v_row FROM billing_plans WHERE billing_plans.plan = v_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown plan %', v_plan;
  END IF;

  v_unit          := billing_config_num('credit_unit_usd', 0.001);
  v_assumed       := billing_config_num('assumed_turn_cost_usd', 0.008333);
  v_idle_minutes  := billing_config_num('conversation_idle_minutes', 30);
  v_max_age_hours := billing_config_num('conversation_max_age_hours', 24);

  v_credits := COALESCE(
    p_credits,
    CASE WHEN p_deep_dive
         THEN billing_config_num('deep_dive_turn_credits', 400)::INTEGER
         ELSE billing_config_num('standard_turn_credits', 100)::INTEGER END
  );
  IF v_credits <= 0 THEN
    RAISE EXCEPTION 'credits per turn must be positive';
  END IF;

  v_ident := chat_identity_key(p_user_id, p_anon_key_hash);

  IF v_row.metering_mode = 'none' THEN
    RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
      0, 0, 0, 0::NUMERIC, 'chat_not_available'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF p_deep_dive AND NOT v_row.allow_deep_dive THEN
    RETURN QUERY SELECT false, v_plan, p_conversation_id, false, NULL::INTEGER,
      NULL::INTEGER, NULL::INTEGER, 0, 0::NUMERIC,
      'deep_dive_requires_premium'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Global free-tier circuit breaker, checked before anything is written.
  IF v_row.metering_mode = 'conversations' THEN
    v_cap := billing_config_num('free_tier_monthly_usd_cap', 0);
    IF v_cap > 0 THEN
      SELECT COALESCE(SUM(est_cost_usd), 0) INTO v_spent
      FROM chat_spend_rollup
      WHERE period_month = v_period AND scope IN ('free', 'anon');
      IF v_spent >= v_cap THEN
        RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
          0, 0, 0, 0::NUMERIC, 'free_tier_budget_exhausted'::TEXT, NULL::UUID;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- --- Resolve the conversation --------------------------------------------
  IF p_conversation_id IS NOT NULL THEN
    SELECT * INTO v_conv
    FROM chat_conversations c
    WHERE c.id = p_conversation_id
      AND (
        (p_user_id IS NOT NULL AND c.user_id = p_user_id)
        OR (p_anon_key_hash IS NOT NULL AND c.anon_key_hash = p_anon_key_hash)
      )
    FOR UPDATE;
    -- An id that isn't ours simply doesn't resolve; we fall through and mint a
    -- fresh one rather than leaking whether it exists.
  END IF;

  IF v_conv.id IS NOT NULL AND v_conv.closed_at IS NULL THEN
    IF v_row.conversation_turn_cap IS NOT NULL
       AND v_conv.turn_count >= v_row.conversation_turn_cap THEN
      UPDATE chat_conversations
        SET closed_at = NOW(), close_reason = 'turn_cap' WHERE id = v_conv.id;
      -- Report the lifetime figure alongside, so the UI can say
      -- "start a new one -- 2 of your 5 free chats left" in one round trip.
      SELECT COALESCE(l.conversations_started, 0), COALESCE(l.bonus_conversations, 0)
        INTO v_life_used, v_life_bonus
        FROM chat_lifetime_conversations l WHERE l.identity_key = v_ident;
      RETURN QUERY SELECT false, v_plan, v_conv.id, false, 0,
        NULL::INTEGER,
        CASE WHEN v_row.lifetime_conversations IS NULL THEN NULL
             ELSE GREATEST(v_row.lifetime_conversations + COALESCE(v_life_bonus,0)
                           - COALESCE(v_life_used,0), 0) END,
        0, 0::NUMERIC, 'conversation_turn_limit'::TEXT, NULL::UUID;
      RETURN;
    END IF;

    IF v_conv.last_turn_at < NOW() - (v_idle_minutes || ' minutes')::INTERVAL THEN
      UPDATE chat_conversations
        SET closed_at = NOW(), close_reason = 'idle' WHERE id = v_conv.id;
      v_conv := NULL;
    ELSIF v_conv.started_at < NOW() - (v_max_age_hours || ' hours')::INTERVAL THEN
      UPDATE chat_conversations
        SET closed_at = NOW(), close_reason = 'max_age' WHERE id = v_conv.id;
      v_conv := NULL;
    END IF;
  ELSE
    v_conv := NULL;
  END IF;

  -- --- Opening a new conversation costs quota -------------------------------
  IF v_conv.id IS NULL THEN
    v_new_conv := true;

    -- Lifetime gate. Takes precedence: when lifetime_conversations is set the
    -- monthly/daily columns are not consulted at all, so switching back to a
    -- monthly allowance is `UPDATE billing_plans SET lifetime_conversations =
    -- NULL, monthly_conversations = 5 WHERE plan = 'free'` and nothing else.
    IF v_row.lifetime_conversations IS NOT NULL AND v_ident IS NOT NULL THEN
      SELECT COALESCE(l.conversations_started, 0), COALESCE(l.bonus_conversations, 0)
        INTO v_life_used, v_life_bonus
      FROM chat_lifetime_conversations l
      WHERE l.identity_key = v_ident
      FOR UPDATE;
      v_life_used  := COALESCE(v_life_used, 0);
      v_life_bonus := COALESCE(v_life_bonus, 0);

      IF v_life_used >= v_row.lifetime_conversations + v_life_bonus THEN
        RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
          NULL::INTEGER, 0, 0, 0::NUMERIC,
          'lifetime_conversation_limit'::TEXT, NULL::UUID;
        RETURN;
      END IF;

    ELSIF v_row.monthly_conversations IS NOT NULL
       OR v_row.daily_conversations IS NOT NULL THEN
      IF p_user_id IS NOT NULL THEN
        SELECT
          COUNT(*) FILTER (WHERE c.started_at >= date_trunc('month', NOW())),
          COUNT(*) FILTER (WHERE c.started_at >= date_trunc('day', NOW()))
        INTO v_conv_month, v_conv_day
        FROM chat_conversations c
        WHERE c.user_id = p_user_id
          AND c.started_at >= date_trunc('month', NOW());
      ELSE
        SELECT
          COUNT(*) FILTER (WHERE c.started_at >= date_trunc('month', NOW())),
          COUNT(*) FILTER (WHERE c.started_at >= date_trunc('day', NOW()))
        INTO v_conv_month, v_conv_day
        FROM chat_conversations c
        WHERE c.anon_key_hash = p_anon_key_hash
          AND c.started_at >= date_trunc('month', NOW());
      END IF;

      IF v_row.monthly_conversations IS NOT NULL
         AND v_conv_month >= v_row.monthly_conversations THEN
        RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
          0, NULL::INTEGER, 0, 0::NUMERIC,
          'monthly_conversation_limit'::TEXT, NULL::UUID;
        RETURN;
      END IF;

      IF v_row.daily_conversations IS NOT NULL
         AND v_conv_day >= v_row.daily_conversations THEN
        RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
          GREATEST(COALESCE(v_row.monthly_conversations, 0) - v_conv_month, 0),
          NULL::INTEGER, 0, 0::NUMERIC,
          'daily_conversation_limit'::TEXT, NULL::UUID;
        RETURN;
      END IF;
    END IF;
  ELSE
    -- Continuing an existing conversation: still report the lifetime balance.
    IF v_row.lifetime_conversations IS NOT NULL AND v_ident IS NOT NULL THEN
      SELECT COALESCE(l.conversations_started, 0), COALESCE(l.bonus_conversations, 0)
        INTO v_life_used, v_life_bonus
      FROM chat_lifetime_conversations l WHERE l.identity_key = v_ident;
      v_life_used  := COALESCE(v_life_used, 0);
      v_life_bonus := COALESCE(v_life_bonus, 0);
    END IF;
  END IF;

  -- --- Credit allowance (Premium) ------------------------------------------
  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(SUM(g.credits), 0) INTO v_bonus
    FROM chat_credit_grants g
    WHERE g.user_id = p_user_id
      AND (g.expires_at IS NULL OR g.expires_at > NOW());

    SELECT COALESCE(SUM(e.credits), 0) INTO v_month_used
    FROM chat_usage_events e
    WHERE e.user_id = p_user_id AND e.created_at >= date_trunc('month', NOW());
  ELSE
    SELECT COALESCE(SUM(e.credits), 0) INTO v_month_used
    FROM chat_usage_events e
    WHERE e.anon_key_hash = p_anon_key_hash
      AND e.created_at >= date_trunc('month', NOW());
  END IF;

  v_allowance := v_row.monthly_credits + v_bonus;
  v_remaining := GREATEST(v_allowance - v_month_used, 0);

  IF v_row.metering_mode = 'credits'
     AND v_month_used + v_credits > v_allowance THEN
    RETURN QUERY SELECT false, v_plan, COALESCE(v_conv.id, p_conversation_id),
      false, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, v_remaining,
      ROUND(v_remaining * v_unit, 2), 'monthly_credit_limit'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- --- Commit ---------------------------------------------------------------
  IF v_new_conv THEN
    INSERT INTO chat_conversations (user_id, anon_key_hash, plan, turn_count)
    VALUES (p_user_id, p_anon_key_hash, v_plan, 1)
    RETURNING * INTO v_conv;
    v_conv_month := v_conv_month + 1;

    -- The lifetime counter is incremented for EVERY plan, not just gated ones.
    -- A user who subscribes and later cancels must land back on the free tier
    -- with the chats they already used still counted; not incrementing for
    -- Premium would hand them a fresh five on downgrade.
    IF v_ident IS NOT NULL THEN
      INSERT INTO chat_lifetime_conversations AS l (
        identity_key, scope, conversations_started,
        first_conversation_at, last_conversation_at
      )
      VALUES (
        v_ident,
        CASE WHEN p_user_id IS NOT NULL THEN 'user' ELSE 'anon' END,
        1, NOW(), NOW()
      )
      ON CONFLICT (identity_key) DO UPDATE SET
        conversations_started = l.conversations_started + 1,
        last_conversation_at  = NOW(),
        updated_at            = NOW()
      RETURNING l.conversations_started, l.bonus_conversations
      INTO v_life_used, v_life_bonus;
    END IF;
  ELSE
    UPDATE chat_conversations
      SET turn_count = turn_count + 1, last_turn_at = NOW()
      WHERE id = v_conv.id
      RETURNING * INTO v_conv;
  END IF;

  INSERT INTO chat_usage_events (
    user_id, anon_key_hash, credits, model, conversation_id, assumed_cost_usd
  )
  VALUES (p_user_id, p_anon_key_hash, v_credits, p_model, v_conv.id, v_assumed)
  RETURNING id INTO v_event_id;

  INSERT INTO chat_spend_rollup AS r (period_month, scope, turns, credits, est_cost_usd)
  VALUES (v_period, v_plan, 1, v_credits, v_assumed)
  ON CONFLICT (period_month, scope) DO UPDATE SET
    turns        = r.turns + 1,
    credits      = r.credits + EXCLUDED.credits,
    est_cost_usd = r.est_cost_usd + EXCLUDED.est_cost_usd,
    updated_at   = NOW();

  v_conv_left := CASE
    WHEN v_row.monthly_conversations IS NULL THEN NULL
    ELSE GREATEST(v_row.monthly_conversations - v_conv_month, 0)
  END;
  v_life_left := CASE
    WHEN v_row.lifetime_conversations IS NULL THEN NULL
    ELSE GREATEST(v_row.lifetime_conversations + COALESCE(v_life_bonus, 0)
                  - COALESCE(v_life_used, 0), 0)
  END;
  v_turns_left := CASE
    WHEN v_row.conversation_turn_cap IS NULL THEN NULL
    ELSE GREATEST(v_row.conversation_turn_cap - v_conv.turn_count, 0)
  END;
  v_remaining := GREATEST(v_allowance - (v_month_used + v_credits), 0);

  RETURN QUERY SELECT
    true, v_plan, v_conv.id, v_new_conv, v_turns_left, v_conv_left, v_life_left,
    v_remaining, ROUND(v_remaining * v_unit, 2), 'ok'::TEXT, v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION consume_chat_turn(UUID, TEXT, UUID, TEXT, BOOLEAN, INTEGER)
  FROM anon, authenticated;

-- Token backfill + rollup correction (re-declared so this file is
-- self-sufficient if 20260821 was skipped).
CREATE OR REPLACE FUNCTION record_chat_usage_tokens(
  p_usage_event_id UUID,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_est_cost_usd NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev NUMERIC;
  v_assumed NUMERIC;
  v_scope TEXT;
  v_period DATE;
BEGIN
  UPDATE chat_usage_events e
  SET input_tokens  = p_input_tokens,
      output_tokens = p_output_tokens,
      est_cost_usd  = p_est_cost_usd
  WHERE e.id = p_usage_event_id
  RETURNING e.est_cost_usd, e.assumed_cost_usd,
            date_trunc('month', e.created_at)::DATE,
            COALESCE(
              (SELECT c.plan FROM chat_conversations c WHERE c.id = e.conversation_id),
              CASE WHEN e.user_id IS NULL THEN 'anon' ELSE 'free' END
            )
  INTO v_prev, v_assumed, v_period, v_scope;

  IF NOT FOUND OR v_assumed IS NULL THEN RETURN; END IF;

  UPDATE chat_spend_rollup
  SET est_cost_usd = GREATEST(est_cost_usd + (p_est_cost_usd - v_assumed), 0),
      updated_at = NOW()
  WHERE period_month = v_period AND scope = v_scope;
END;
$$;

REVOKE ALL ON FUNCTION record_chat_usage_tokens(UUID, INTEGER, INTEGER, NUMERIC)
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION close_my_chat_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE chat_conversations
  SET closed_at = NOW(), close_reason = 'client'
  WHERE id = p_conversation_id
    AND user_id = auth.uid()
    AND closed_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION close_my_chat_conversation(UUID) TO authenticated;

-- One-time v1 -> v2 credit rescale, replicated here so this file is
-- self-sufficient if 20260821 was skipped. The marker key makes it a no-op
-- when 20260821 already ran it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM billing_config WHERE key = 'credit_scale_rev') THEN
    UPDATE chat_usage_events SET credits = credits * 100;
    UPDATE chat_credit_grants SET credits = credits * 100;
    INSERT INTO billing_config (key, value, description, is_public)
    VALUES ('credit_scale_rev', 2,
            'Marker: v1 (1 credit = 1 turn) ledger rows have been rescaled to '
            'v2 (1 credit = $0.001). Do not delete.', false);
  END IF;
END;
$$;
