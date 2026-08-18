-- Billing: subscriptions, entitlements, and AI-chat usage metering.
--
-- Design (see docs/payment-model.md):
--   * The product stays free to browse. The ONLY metered resource is the AI
--     chat assistant, which has real per-message Anthropic API cost.
--   * Metering unit is a "credit": 1 credit = one Haiku turn, 5 credits = one
--     Sonnet ("deep dive") turn. Plan allowances live in billing_plans so the
--     limits can be tuned with an UPDATE instead of a redeploy.
--   * Stripe is the source of truth for money; this schema mirrors just enough
--     of it (customer id, subscription status, period end) to answer
--     "what is this user entitled to right now?" in one indexed read.
--
-- RLS posture, matching the rest of the repo:
--   * Users may SELECT their own billing rows. They may never INSERT or UPDATE
--     them -- every write comes from the Stripe webhook (service role) or from
--     the SECURITY DEFINER metering function below.
--   * billing_plans is public read (anon + authenticated) so a pricing page /
--     upgrade prompt can render without a session.
--   * The two "my_*" views are owner-rights views filtered by auth.uid(), the
--     same shape as public_favorites (20260717).

-- 1. Plan catalog ------------------------------------------------------------
-- Seeded reference data. stripe_price_id_* are filled in after the prices are
-- created in the Stripe dashboard (see docs/payment-model.md).

CREATE TABLE IF NOT EXISTS billing_plans (
  plan TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  -- Chat allowances. NULL daily_credits = no daily sub-cap.
  monthly_credits INTEGER NOT NULL CHECK (monthly_credits >= 0),
  daily_credits INTEGER CHECK (daily_credits >= 0),
  allow_deep_dive BOOLEAN NOT NULL DEFAULT false,
  -- Display pricing in minor units (cents, USD). 0 for the free plan.
  price_cents_monthly INTEGER NOT NULL DEFAULT 0,
  price_cents_yearly INTEGER NOT NULL DEFAULT 0,
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO billing_plans (
  plan, display_name, monthly_credits, daily_credits, allow_deep_dive,
  price_cents_monthly, price_cents_yearly, sort_order
) VALUES
  ('anon',  'Signed out', 6,   3,    false, 0,   0,    0),
  ('free',  'Free',       30,  5,    false, 0,   0,    1),
  ('plus',  'Plus',       300, NULL, true,  500, 4500, 2)
ON CONFLICT (plan) DO NOTHING;

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read plans" ON billing_plans;
CREATE POLICY "Anyone can read plans"
  ON billing_plans FOR SELECT
  TO anon, authenticated
  USING (true);

-- 2. Stripe customer mapping -------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_customers (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner; writes are service-role only (no INSERT/UPDATE
-- policies, so PostgREST rejects them for anon/authenticated).
DROP POLICY IF EXISTS "Users can view their own billing customer" ON billing_customers;
CREATE POLICY "Users can view their own billing customer"
  ON billing_customers FOR SELECT
  USING (auth.uid() = user_id);

-- 3. Subscriptions -----------------------------------------------------------
-- One row per Stripe subscription. A user can in principle have more than one
-- (e.g. a resubscribe while the old one is still winding down), so entitlement
-- is derived from "is there ANY active-ish row", not from a single row.

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT,
  plan TEXT NOT NULL REFERENCES billing_plans(plan),
  -- Mirrors Stripe: trialing | active | past_due | canceled | incomplete |
  -- incomplete_expired | unpaid | paused
  status TEXT NOT NULL,
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user_status
  ON billing_subscriptions (user_id, status);

ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON billing_subscriptions;
CREATE POLICY "Users can view their own subscriptions"
  ON billing_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- 4. One-off credit grants ---------------------------------------------------
-- Top-up packs, support goodwill, promo credits. Consumed before plan credits
-- are considered exhausted (see consume_chat_credits below).

CREATE TABLE IF NOT EXISTS chat_credit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL CHECK (credits > 0),
  -- 'topup' (paid pack), 'promo', 'support'
  source TEXT NOT NULL DEFAULT 'topup',
  stripe_payment_intent_id TEXT UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_credit_grants_user
  ON chat_credit_grants (user_id, expires_at);

ALTER TABLE chat_credit_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own credit grants" ON chat_credit_grants;
CREATE POLICY "Users can view their own credit grants"
  ON chat_credit_grants FOR SELECT
  USING (auth.uid() = user_id);

-- 5. Usage ledger ------------------------------------------------------------
-- Append-only. One row per chat turn that was allowed to run. Token counts and
-- est_cost_usd are recorded after the fact by the chat function so unit
-- economics can be checked against reality (see docs/payment-model.md).
--
-- Signed-out callers are metered by anon_key_hash: a SHA-256 of
-- (client-supplied device id + a server-side salt). It is a speed bump, not a
-- security control -- the real backstop for abuse is that the free anonymous
-- allowance is tiny.

CREATE TABLE IF NOT EXISTS chat_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  anon_key_hash TEXT,
  credits INTEGER NOT NULL CHECK (credits > 0),
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  est_cost_usd NUMERIC(10, 6),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Exactly one identity per row.
  CONSTRAINT chat_usage_events_identity
    CHECK ((user_id IS NOT NULL) <> (anon_key_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_chat_usage_events_user_created
  ON chat_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_usage_events_anon_created
  ON chat_usage_events (anon_key_hash, created_at DESC);

ALTER TABLE chat_usage_events ENABLE ROW LEVEL SECURITY;

-- Owner may read their own usage (to render "23 of 30 messages left").
-- No INSERT policy: rows are written only by consume_chat_credits() and the
-- service role.
DROP POLICY IF EXISTS "Users can view their own chat usage" ON chat_usage_events;
CREATE POLICY "Users can view their own chat usage"
  ON chat_usage_events FOR SELECT
  USING (auth.uid() = user_id);

-- 6. Webhook idempotency -----------------------------------------------------
-- Stripe retries deliveries; the webhook inserts here first and bails on
-- conflict so a replayed event can never double-grant credits.

CREATE TABLE IF NOT EXISTS billing_events (
  stripe_event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- RLS on with zero policies: unreachable from anon/authenticated, readable by
-- the service role and via the dashboard. Same posture as product_submissions.
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- 7. updated_at triggers -----------------------------------------------------

CREATE OR REPLACE FUNCTION billing_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_plans_updated_at ON billing_plans;
CREATE TRIGGER billing_plans_updated_at
  BEFORE UPDATE ON billing_plans
  FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();

DROP TRIGGER IF EXISTS billing_customers_updated_at ON billing_customers;
CREATE TRIGGER billing_customers_updated_at
  BEFORE UPDATE ON billing_customers
  FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();

DROP TRIGGER IF EXISTS billing_subscriptions_updated_at ON billing_subscriptions;
CREATE TRIGGER billing_subscriptions_updated_at
  BEFORE UPDATE ON billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION billing_touch_updated_at();

-- 8. Entitlement resolution --------------------------------------------------
-- The single answer to "which plan is this user on?". A subscription counts as
-- entitling while Stripe reports trialing/active/past_due -- past_due keeps
-- access during the dunning window rather than cutting a paying customer off
-- on a transient card decline.

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
    'free'
  );
$$;

-- Current entitlement + remaining allowance for the CALLER. Owner-rights view
-- filtered by auth.uid(), so it can read the billing tables without granting
-- users cross-row access.
CREATE OR REPLACE VIEW my_chat_entitlement AS
SELECT
  u.id AS user_id,
  pl.plan,
  pl.display_name,
  pl.monthly_credits,
  pl.daily_credits,
  pl.allow_deep_dive,
  COALESCE(month.used, 0) AS credits_used_this_month,
  COALESCE(today.used, 0) AS credits_used_today,
  COALESCE(grants.credits, 0) AS bonus_credits,
  GREATEST(
    pl.monthly_credits + COALESCE(grants.credits, 0) - COALESCE(month.used, 0),
    0
  ) AS credits_remaining_this_month,
  sub.status AS subscription_status,
  sub.current_period_end,
  sub.cancel_at_period_end
FROM auth.users u
CROSS JOIN LATERAL (
  SELECT * FROM billing_plans WHERE plan = billing_plan_for_user(u.id)
) pl
LEFT JOIN LATERAL (
  SELECT SUM(credits) AS used
  FROM chat_usage_events e
  WHERE e.user_id = u.id
    AND e.created_at >= date_trunc('month', NOW())
) month ON true
LEFT JOIN LATERAL (
  SELECT SUM(credits) AS used
  FROM chat_usage_events e
  WHERE e.user_id = u.id
    AND e.created_at >= date_trunc('day', NOW())
) today ON true
LEFT JOIN LATERAL (
  SELECT SUM(credits) AS credits
  FROM chat_credit_grants g
  WHERE g.user_id = u.id
    AND (g.expires_at IS NULL OR g.expires_at > NOW())
) grants ON true
LEFT JOIN LATERAL (
  SELECT status, current_period_end, cancel_at_period_end
  FROM billing_subscriptions s
  WHERE s.user_id = u.id
    AND s.status IN ('trialing', 'active', 'past_due')
  ORDER BY s.created_at DESC
  LIMIT 1
) sub ON true
WHERE u.id = auth.uid();

GRANT SELECT ON my_chat_entitlement TO authenticated;

-- 9. Metering gate -----------------------------------------------------------
-- Called by the chat edge function BEFORE it talks to Anthropic. Atomically
-- checks the caller's allowance and, if there's room, records the spend.
--
-- Returns one row: (allowed, plan, credits_remaining, reason).
--   reason: 'ok' | 'monthly_limit' | 'daily_limit' | 'deep_dive_requires_plus'
--
-- SECURITY DEFINER because chat_usage_events has no INSERT policy. p_user_id
-- is NOT trusted from the client: the edge function resolves it from the
-- verified JWT and passes it here with the service-role key.

CREATE OR REPLACE FUNCTION consume_chat_credits(
  p_user_id UUID,
  p_anon_key_hash TEXT,
  p_credits INTEGER,
  p_model TEXT,
  p_deep_dive BOOLEAN DEFAULT false
)
RETURNS TABLE (
  allowed BOOLEAN,
  plan TEXT,
  credits_remaining INTEGER,
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
  v_bonus INTEGER := 0;
  v_month_used INTEGER := 0;
  v_day_used INTEGER := 0;
  v_allowance INTEGER;
  v_remaining INTEGER;
  v_event_id UUID;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'p_credits must be positive';
  END IF;
  IF (p_user_id IS NULL) = (p_anon_key_hash IS NULL) THEN
    RAISE EXCEPTION 'exactly one of p_user_id / p_anon_key_hash is required';
  END IF;

  IF p_user_id IS NULL THEN
    v_plan := 'anon';
  ELSE
    v_plan := billing_plan_for_user(p_user_id);
  END IF;

  SELECT * INTO v_row FROM billing_plans WHERE billing_plans.plan = v_plan;

  IF p_deep_dive AND NOT v_row.allow_deep_dive THEN
    RETURN QUERY SELECT false, v_plan, 0, 'deep_dive_requires_plus'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT COALESCE(SUM(credits), 0) INTO v_bonus
    FROM chat_credit_grants g
    WHERE g.user_id = p_user_id
      AND (g.expires_at IS NULL OR g.expires_at > NOW());

    SELECT COALESCE(SUM(credits), 0) INTO v_month_used
    FROM chat_usage_events e
    WHERE e.user_id = p_user_id AND e.created_at >= date_trunc('month', NOW());

    SELECT COALESCE(SUM(credits), 0) INTO v_day_used
    FROM chat_usage_events e
    WHERE e.user_id = p_user_id AND e.created_at >= date_trunc('day', NOW());
  ELSE
    SELECT COALESCE(SUM(credits), 0) INTO v_month_used
    FROM chat_usage_events e
    WHERE e.anon_key_hash = p_anon_key_hash
      AND e.created_at >= date_trunc('month', NOW());

    SELECT COALESCE(SUM(credits), 0) INTO v_day_used
    FROM chat_usage_events e
    WHERE e.anon_key_hash = p_anon_key_hash
      AND e.created_at >= date_trunc('day', NOW());
  END IF;

  v_allowance := v_row.monthly_credits + v_bonus;
  v_remaining := GREATEST(v_allowance - v_month_used, 0);

  IF v_month_used + p_credits > v_allowance THEN
    RETURN QUERY SELECT false, v_plan, v_remaining, 'monthly_limit'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_row.daily_credits IS NOT NULL
     AND v_day_used + p_credits > v_row.daily_credits THEN
    RETURN QUERY SELECT false, v_plan, v_remaining, 'daily_limit'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO chat_usage_events (user_id, anon_key_hash, credits, model)
  VALUES (p_user_id, p_anon_key_hash, p_credits, p_model)
  RETURNING id INTO v_event_id;

  RETURN QUERY SELECT
    true,
    v_plan,
    GREATEST(v_allowance - (v_month_used + p_credits), 0),
    'ok'::TEXT,
    v_event_id;
END;
$$;

-- Called only with the service-role key from the chat edge function.
REVOKE ALL ON FUNCTION consume_chat_credits(UUID, TEXT, INTEGER, TEXT, BOOLEAN)
  FROM anon, authenticated;

-- Backfills token counts / cost on a usage event once the Anthropic call
-- returns. Separate from the gate so a failed model call still leaves an
-- accurate (token-less) debit rather than free usage.
CREATE OR REPLACE FUNCTION record_chat_usage_tokens(
  p_usage_event_id UUID,
  p_input_tokens INTEGER,
  p_output_tokens INTEGER,
  p_est_cost_usd NUMERIC
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE chat_usage_events
  SET input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      est_cost_usd = p_est_cost_usd
  WHERE id = p_usage_event_id;
$$;

REVOKE ALL ON FUNCTION record_chat_usage_tokens(UUID, INTEGER, INTEGER, NUMERIC)
  FROM anon, authenticated;
