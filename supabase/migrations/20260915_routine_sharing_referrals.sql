-- Routine sharing + referrals (2026-09-15).
--
-- Two growth loops that ride on the cabinet:
--
--   1. PUBLIC ROUTINES. /r/<username> shows a user's AM/PM routine to anyone.
--      Going public is what unlocks "from routines like yours" -- product
--      recommendations mined from what OTHER public users keep in their
--      cabinets. Reciprocity, not a paywall: you see the pool once you're in
--      it. Everything returned is aggregate (counts), never who.
--
--   2. REFERRALS. Each profile carries a short code; /?ref=<code> is captured
--      client-side and claimed after sign-in through claim_referral(). Both
--      sides get 7 days of Premium as a COMP -- a row in billing_comp_grants,
--      which billing_plan_for_user() now honours alongside Stripe. No Stripe
--      object is created, so nothing ever bills at the end of the week; the
--      comp just lapses back to 'free'.
--
-- Cost ceiling of a comp week: Premium's monthly credits are metered by
-- calendar month, so a one-week comp can in principle spend the whole $10
-- consumer allowance (~$0.83 real at 12x). With the per-referrer cap below
-- that bounds abuse at ~$8/referrer/month, and OAuth-only signup makes
-- throwaway accounts expensive to farm.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Profile flags
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS routine_public BOOLEAN NOT NULL DEFAULT false;

-- 40 bits of hex: short enough for a URL, sparse enough that guessing one is
-- pointless (a guessed code only ever benefits the code's owner anyway).
CREATE OR REPLACE FUNCTION dermodel_referral_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT substr(md5(gen_random_uuid()::text), 1, 10);
$$;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT NOT NULL DEFAULT dermodel_referral_code();

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON profiles (lower(referral_code));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Public routines
-- ───────────────────────────────────────────────────────────────────────────
-- Same posture as public_favorites: owner-rights view, joined on the opt-in
-- flag, exposing username + product + routine slot only. No sizes, no dates,
-- no email -- when someone opened a bottle is nobody's business.

CREATE OR REPLACE VIEW public_routines AS
SELECT
  c.user_id,
  pr.username,
  c.product_id,
  p.product_name,
  p.ingredient_count,
  p.image_url,
  p.image_source_url,
  p.image_attribution,
  c.routine,
  c.frequency
FROM cabinet_items c
JOIN profiles pr ON pr.id = c.user_id AND pr.routine_public
JOIN sss_products p ON p.product_id = c.product_id
WHERE c.status = 'active';

GRANT SELECT ON public_routines TO anon, authenticated;

-- "From routines like yours." For the CALLER, and only while their own
-- routine is public. Scores every product in other public cabinets by how
-- much those cabinets overlap with the caller's, so a user with an empty
-- cabinet just sees the most-kept products across the pool (overlap 0 for
-- everyone -> ordered by how many people keep it).
--
-- SQL, not plpgsql: RETURNS TABLE columns would shadow the joined columns in
-- a plpgsql body and turn every reference into an "ambiguous" error.
CREATE OR REPLACE FUNCTION routine_recommendations(p_limit INT DEFAULT 12)
RETURNS TABLE (
  product_id   TEXT,
  product_name TEXT,
  image_url    TEXT,
  routine      TEXT,
  shared_by    INT,
  overlap      INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT c.product_id
    FROM cabinet_items c
    WHERE c.user_id = auth.uid() AND c.status = 'active'
  ),
  others AS (
    SELECT c.user_id, c.product_id, c.routine
    FROM cabinet_items c
    JOIN profiles pr ON pr.id = c.user_id AND pr.routine_public
    WHERE c.status = 'active' AND c.user_id <> auth.uid()
  ),
  overlap AS (
    SELECT o.user_id, COUNT(*) AS n
    FROM others o JOIN mine m ON m.product_id = o.product_id
    GROUP BY o.user_id
  ),
  cand AS (
    SELECT o.product_id, o.user_id, o.routine, COALESCE(ov.n, 0) AS n
    FROM others o
    LEFT JOIN overlap ov ON ov.user_id = o.user_id
    WHERE o.product_id NOT IN (SELECT m.product_id FROM mine m)
  )
  SELECT
    c.product_id,
    p.product_name,
    p.image_url,
    mode() WITHIN GROUP (ORDER BY c.routine) AS routine,
    COUNT(DISTINCT c.user_id)::INT AS shared_by,
    SUM(c.n)::INT AS overlap
  FROM cand c
  JOIN sss_products p ON p.product_id = c.product_id
  WHERE EXISTS (
    SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.routine_public
  )
  GROUP BY c.product_id, p.product_name, p.image_url, p.like_count
  ORDER BY SUM(c.n) DESC, COUNT(DISTINCT c.user_id) DESC, p.like_count DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
$$;

-- How many OTHER routines are public -- the number the locked state shows.
CREATE OR REPLACE FUNCTION routine_recommendations_count()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT c.user_id)::INT
  FROM cabinet_items c
  JOIN profiles pr ON pr.id = c.user_id AND pr.routine_public
  WHERE c.status = 'active' AND c.user_id IS DISTINCT FROM auth.uid();
$$;

REVOKE ALL ON FUNCTION routine_recommendations(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION routine_recommendations(INT) TO authenticated;
REVOKE ALL ON FUNCTION routine_recommendations_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION routine_recommendations_count() TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Comps: Premium without a Stripe subscription
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_comp_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL REFERENCES billing_plans(plan),
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at     TIMESTAMPTZ NOT NULL,
  -- 'referral' | 'support' | 'promo'
  source      TEXT NOT NULL,
  referral_id UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_billing_comp_grants_user
  ON billing_comp_grants (user_id, ends_at);

ALTER TABLE billing_comp_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own comps" ON billing_comp_grants;
CREATE POLICY "Users can view their own comps"
  ON billing_comp_grants FOR SELECT
  USING (auth.uid() = user_id);
-- No INSERT policy: comps are written by claim_referral() or an operator.

-- A paid subscription wins; otherwise a live comp; otherwise free. Same
-- signature and grants as before, so every caller (consume_chat_turn,
-- bella_checkin_candidates, my_chat_entitlement) picks this up unchanged.
CREATE OR REPLACE FUNCTION billing_plan_for_user(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT s.plan
      FROM billing_subscriptions s
      JOIN billing_plans p ON p.plan = s.plan
      WHERE s.user_id = p_user_id
        AND s.status IN ('trialing', 'active', 'past_due')
      ORDER BY p.sort_order DESC
      LIMIT 1
    ),
    (
      SELECT g.plan
      FROM billing_comp_grants g
      JOIN billing_plans p ON p.plan = g.plan
      WHERE g.user_id = p_user_id
        AND g.starts_at <= NOW()
        AND g.ends_at > NOW()
      ORDER BY p.sort_order DESC, g.ends_at DESC
      LIMIT 1
    ),
    'free'
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Referrals
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referrals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- One referral per new account, ever.
  referred_id  UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (referrer_id <> referred_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals (referrer_id, created_at);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view referrals they are part of" ON referrals;
CREATE POLICY "Users can view referrals they are part of"
  ON referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- Tunables live in billing_config so they're an UPDATE, not a migration.
INSERT INTO billing_config (key, value, description) VALUES
  ('referral_comp_days',        7,  'Days of Premium each side of a referral receives'),
  ('referral_claim_window_days',7,  'A new account can claim a referral this long after signup'),
  ('referral_max_per_30d',      10, 'Referrals one referrer can be credited for per rolling 30 days')
ON CONFLICT (key) DO NOTHING;

-- Called by the referred user after sign-in with the code from /?ref=.
-- Returns a status string the client can toast on; never raises for a bad
-- code, since a failed claim is not an error the user can do anything about.
--
--   'granted'          both sides now hold a comp
--   'already_referred' this account has claimed before
--   'invalid_code'     no such code
--   'self'             own code
--   'too_old'          account is past the claim window (existing users
--                      farming their friends' weeks)
--   'referrer_capped'  referrer hit the 30-day cap; the new user still gets
--                      THEIR week -- the person who clicked the link shouldn't
--                      pay for the referrer's enthusiasm
CREATE OR REPLACE FUNCTION claim_referral(p_code TEXT)
RETURNS TABLE (status TEXT, comp_until TIMESTAMPTZ)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        UUID := auth.uid();
  v_referrer  UUID;
  v_created   TIMESTAMPTZ;
  v_days      INT := billing_config_num('referral_comp_days', 7)::INT;
  v_window    INT := billing_config_num('referral_claim_window_days', 7)::INT;
  v_cap       INT := billing_config_num('referral_max_per_30d', 10)::INT;
  v_recent    INT;
  v_ref_id    UUID;
  v_start     TIMESTAMPTZ;
  v_end       TIMESTAMPTZ;
  v_capped    BOOLEAN := false;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT 'not_signed_in'::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM referrals r WHERE r.referred_id = v_me) THEN
    RETURN QUERY SELECT 'already_referred'::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;

  SELECT p.id INTO v_referrer
  FROM profiles p
  WHERE lower(p.referral_code) = lower(trim(coalesce(p_code, '')));
  IF v_referrer IS NULL THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_referrer = v_me THEN
    RETURN QUERY SELECT 'self'::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;

  SELECT p.created_at INTO v_created FROM profiles p WHERE p.id = v_me;
  IF v_created < NOW() - make_interval(days => v_window) THEN
    RETURN QUERY SELECT 'too_old'::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;

  -- Serialise per referrer so two claims in the same instant can't both slip
  -- under the cap.
  PERFORM pg_advisory_xact_lock(hashtext('referral:' || v_referrer::text));

  SELECT COUNT(*) INTO v_recent
  FROM referrals r
  WHERE r.referrer_id = v_referrer AND r.created_at > NOW() - INTERVAL '30 days';
  v_capped := v_recent >= v_cap;

  INSERT INTO referrals (referrer_id, referred_id, code)
  VALUES (v_referrer, v_me, lower(trim(p_code)))
  RETURNING id INTO v_ref_id;

  -- Referred user: starts now (or after any comp they already hold).
  SELECT GREATEST(NOW(), COALESCE(MAX(g.ends_at), NOW())) INTO v_start
  FROM billing_comp_grants g WHERE g.user_id = v_me;
  v_end := v_start + make_interval(days => v_days);
  INSERT INTO billing_comp_grants (user_id, plan, starts_at, ends_at, source, referral_id)
  VALUES (v_me, 'premium', v_start, v_end, 'referral', v_ref_id);

  -- Referrer: same, unless capped. Comps stack end-to-end, so five referrals
  -- is five weeks. (For an active Stripe subscriber the comp is moot while
  -- they pay -- the subscription already wins in billing_plan_for_user -- but
  -- it's still recorded and takes over if they cancel before it lapses.)
  IF NOT v_capped THEN
    INSERT INTO billing_comp_grants (user_id, plan, starts_at, ends_at, source, referral_id)
    SELECT v_referrer, 'premium', s.start_at, s.start_at + make_interval(days => v_days),
           'referral', v_ref_id
    FROM (
      SELECT GREATEST(NOW(), COALESCE(MAX(g.ends_at), NOW())) AS start_at
      FROM billing_comp_grants g WHERE g.user_id = v_referrer
    ) s;
  END IF;

  RETURN QUERY SELECT (CASE WHEN v_capped THEN 'referrer_capped' ELSE 'granted' END)::TEXT, v_end;
END;
$$;

REVOKE ALL ON FUNCTION claim_referral(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_referral(TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Surface the comp in the entitlement view
-- ───────────────────────────────────────────────────────────────────────────
-- Identical to 20260824's definition plus two trailing columns (OR REPLACE
-- only allows appending), so the Settings card can say "Premium until <date>"
-- instead of implying a renewal that will never bill.

CREATE OR REPLACE VIEW my_chat_entitlement AS
SELECT
  u.id AS user_id,
  pl.plan,
  pl.display_name,
  pl.metering_mode,

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

  pl.includes_cabinet_memory,
  pl.includes_checkin_emails,
  pl.includes_surveys,
  pl.includes_referrals,

  reg.policy AS region_policy,
  reg.country AS region_country,
  reg.country_source AS region_country_source,
  reg.sell_premium,
  dermodel_checkin_emails_allowed(u.id) AS checkin_emails_effective,
  (NOT reg.marketing_default_opt_in
   AND consent.action IS NULL
   AND reg.policy <> 'avoid') AS checkin_email_consent_required,
  consent.action AS checkin_email_consent_action,
  consent.occurred_at AS checkin_email_consent_at,

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

  sub.status AS subscription_status,
  sub.current_period_end,
  sub.cancel_at_period_end,

  -- NEW: where the plan comes from, and when a comp lapses.
  CASE
    WHEN sub.status IS NOT NULL THEN 'subscription'
    WHEN comp.ends_at IS NOT NULL THEN 'comp'
    ELSE 'none'
  END AS plan_source,
  comp.ends_at AS comp_until
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
LEFT JOIN LATERAL (
  SELECT MAX(g.ends_at) AS ends_at
  FROM billing_comp_grants g
  WHERE g.user_id = u.id AND g.starts_at <= NOW() AND g.ends_at > NOW()
) comp ON true
WHERE u.id = auth.uid();

GRANT SELECT ON my_chat_entitlement TO authenticated;
