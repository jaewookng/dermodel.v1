-- Billing v2: memory-first pricing, three billing intervals, conversation
-- metering for the free tier and dollar-denominated credits for Premium.
--
-- Supersedes the pricing/metering half of 20260818_billing.sql, which is
-- ALREADY APPLIED IN PRODUCTION and must not be edited. Everything here is
-- additive or a replace-in-place, and every statement is idempotent so this
-- file can be re-run safely.
--
-- What changed from v1 (see docs/payment-model.md §1 "What changed"):
--
--   * The recurring product is MEMORY (cabinet tracking, replenishment
--     check-in email, surveys, referrals), not chat volume. Chat is a bonus.
--   * One paid plan, "Premium", at $8.99/mo -- plus a 6-month prepay at 10%
--     off and an annual prepay at 15% off. The applied schema only had
--     monthly/yearly price columns; a semiannual pair is added here.
--   * Free (including signed out) is metered in CONVERSATIONS PER MONTH (5),
--     not credits. Premium is metered in credits, where a credit is now a
--     unit of USER-FACING dollar value rather than "one Haiku turn".
--   * Credit unit redefinition: 1 credit = $0.001 of user-facing credit
--     value. The $10/mo Premium allowance is 10,000 credits; a standard turn
--     costs 100 credits ($0.10) and a deep dive 400 ($0.40). See the
--     one-time rescale in section 9 for pre-existing ledger rows.
--   * The v1 'plus' plan row is retired (dropped if unreferenced, otherwise
--     kept as a non-public legacy alias so the FK from
--     billing_subscriptions.plan never dangles).
--
-- The v1 objects that still hold are reused as-is: billing_customers,
-- billing_subscriptions, chat_credit_grants, billing_events, the updated_at
-- trigger function, and billing_plan_for_user().

-- ---------------------------------------------------------------------------
-- 1. Tunable constants -------------------------------------------------------
-- Pricing/metering constants live in a table, not in code or in an edge
-- function, so retuning is an UPDATE rather than a redeploy -- the same
-- posture billing_plans already takes for allowances.

CREATE TABLE IF NOT EXISTS billing_config (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  description TEXT,
  -- Public constants render on the pricing page / in the chat UI. Internal
  -- ones (cost assumptions, the free-tier circuit breaker) must not leak.
  is_public BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO billing_config (key, value, description, is_public) VALUES
  ('credit_unit_usd', 0.001,
   'User-facing dollar value of one credit. 1000 credits = $1.00.', true),
  ('standard_turn_credits', 100,
   'Credits charged for one standard (Haiku) chat turn. 100 = $0.10.', true),
  ('deep_dive_turn_credits', 400,
   'Credits charged for one deep-dive (Sonnet) chat turn. 400 = $0.40.', true),
  ('markup_multiple', 11.12,
   'User-facing credit dollars per real Anthropic dollar. Back-solved so a '
   'fully consumed $10 allowance costs ~10% of $8.99 revenue.', false),
  ('assumed_turn_cost_usd', 0.009,
   'Planning estimate of the real Anthropic cost of one standard turn, used '
   'for the spend rollup before real token counts are backfilled.', false),
  ('conversation_idle_minutes', 30,
   'A conversation with no turn for this long is closed; the next turn opens '
   'a new one (and consumes another conversation from the monthly quota).', false),
  ('conversation_max_age_hours', 24,
   'Absolute lifetime of a conversation, so one id cannot span weeks.', false),
  ('free_tier_monthly_usd_cap', 500,
   'Circuit breaker: once free+anon chat has burned this much real spend in a '
   'calendar month, free chat is cut off until the month rolls. 0 disables.', false)
ON CONFLICT (key) DO NOTHING;

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

-- Lookup helper. STABLE so the planner can hoist it out of the gate function.
CREATE OR REPLACE FUNCTION billing_config_num(p_key TEXT, p_default NUMERIC DEFAULT 0)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM billing_config WHERE key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- 2. Plan catalog: three intervals, conversation quotas, feature flags -------

ALTER TABLE billing_plans
  -- The 6-month prepay the applied schema had no room for.
  ADD COLUMN IF NOT EXISTS price_cents_semiannual INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_price_id_semiannual TEXT,
  -- How this plan is gated. 'conversations' = free tier (N chats/month,
  -- turn-capped). 'credits' = Premium ($ allowance). 'none' = no chat at all.
  ADD COLUMN IF NOT EXISTS metering_mode TEXT NOT NULL DEFAULT 'credits',
  -- NULL = unlimited.
  ADD COLUMN IF NOT EXISTS monthly_conversations INTEGER,
  ADD COLUMN IF NOT EXISTS daily_conversations INTEGER,
  ADD COLUMN IF NOT EXISTS conversation_turn_cap INTEGER,
  -- Display only: the "$10 of Bella usage credits" headline.
  ADD COLUMN IF NOT EXISTS credit_allowance_usd NUMERIC(8, 2) NOT NULL DEFAULT 0,
  -- The actual v2 value proposition.
  ADD COLUMN IF NOT EXISTS includes_cabinet_memory BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_checkin_emails BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_surveys BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_referrals BOOLEAN NOT NULL DEFAULT false,
  -- Retired plans stay in the table for FK integrity but leave the pricing page.
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

-- Premium. monthly_credits is now denominated in credits-as-milli-dollars:
-- 10000 credits = $10.00 of user-facing allowance, per CALENDAR MONTH,
-- identically for all three billing intervals (see docs §5 for why the
-- allowance is not granted per invoice).
INSERT INTO billing_plans (
  plan, display_name, monthly_credits, daily_credits, allow_deep_dive,
  price_cents_monthly, price_cents_yearly, price_cents_semiannual,
  metering_mode, monthly_conversations, daily_conversations,
  conversation_turn_cap, credit_allowance_usd,
  includes_cabinet_memory, includes_checkin_emails, includes_surveys,
  includes_referrals, is_public, sort_order
) VALUES (
  'premium', 'Premium', 10000, NULL, true,
  899, 9168, 4854,
  'credits', NULL, NULL,
  NULL, 10.00,
  true, true, true,
  true, true, 3
)
ON CONFLICT (plan) DO UPDATE SET
  display_name              = EXCLUDED.display_name,
  monthly_credits           = EXCLUDED.monthly_credits,
  daily_credits             = EXCLUDED.daily_credits,
  allow_deep_dive           = EXCLUDED.allow_deep_dive,
  price_cents_monthly       = EXCLUDED.price_cents_monthly,
  price_cents_yearly        = EXCLUDED.price_cents_yearly,
  price_cents_semiannual    = EXCLUDED.price_cents_semiannual,
  metering_mode             = EXCLUDED.metering_mode,
  monthly_conversations     = EXCLUDED.monthly_conversations,
  daily_conversations       = EXCLUDED.daily_conversations,
  conversation_turn_cap     = EXCLUDED.conversation_turn_cap,
  credit_allowance_usd      = EXCLUDED.credit_allowance_usd,
  includes_cabinet_memory   = EXCLUDED.includes_cabinet_memory,
  includes_checkin_emails   = EXCLUDED.includes_checkin_emails,
  includes_surveys          = EXCLUDED.includes_surveys,
  includes_referrals        = EXCLUDED.includes_referrals,
  is_public                 = EXCLUDED.is_public,
  sort_order                = EXCLUDED.sort_order;
-- NOTE: stripe_price_id_* are deliberately NOT in the DO UPDATE list, so
-- re-running this migration never wipes ids written after the Stripe products
-- were created.

-- Free and signed-out are now conversation-metered. monthly_credits drops to 0
-- because credits are not the gate for these plans -- metering_mode is.
-- conversation_turn_cap is the thing that stops one conversation being held
-- open forever to farm unlimited turns.
UPDATE billing_plans SET
  display_name          = 'Free',
  metering_mode         = 'conversations',
  monthly_conversations = 5,
  daily_conversations   = NULL,
  conversation_turn_cap = 12,
  monthly_credits       = 0,
  daily_credits         = NULL,
  allow_deep_dive       = false,
  credit_allowance_usd  = 0,
  is_public             = true,
  sort_order            = 1
WHERE plan = 'free';

-- Signed out mirrors Free per the owner's "Free (incl. signed out)" decision.
-- ⚠️ This is trivially farmable (clear localStorage -> new identity). It is a
-- top-of-funnel bet, not a security control; lowering monthly_conversations
-- here is a one-line UPDATE if the ledger shows abuse. See docs §7.
UPDATE billing_plans SET
  display_name          = 'Signed out',
  metering_mode         = 'conversations',
  monthly_conversations = 5,
  daily_conversations   = NULL,
  conversation_turn_cap = 12,
  monthly_credits       = 0,
  daily_credits         = NULL,
  allow_deep_dive       = false,
  credit_allowance_usd  = 0,
  is_public             = false,
  sort_order            = 0
WHERE plan = 'anon';

-- Retire the v1 'plus' plan. Drop it outright if nothing references it;
-- otherwise keep the row (the FK from billing_subscriptions.plan requires it)
-- but hide it and give it Premium's entitlements so a v1 subscriber is never
-- worse off than a v2 one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing_plans WHERE plan = 'plus') THEN
    IF EXISTS (SELECT 1 FROM billing_subscriptions WHERE plan = 'plus') THEN
      UPDATE billing_plans SET
        display_name            = 'Plus (legacy)',
        metering_mode           = 'credits',
        monthly_credits         = 10000,
        daily_credits           = NULL,
        allow_deep_dive         = true,
        credit_allowance_usd    = 10.00,
        includes_cabinet_memory = true,
        includes_checkin_emails = true,
        includes_surveys        = true,
        includes_referrals      = true,
        is_public               = false,
        sort_order              = 2
      WHERE plan = 'plus';
    ELSE
      DELETE FROM billing_plans WHERE plan = 'plus';
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Conversations -----------------------------------------------------------
-- The free tier is denominated in conversations, so a conversation has to be a
-- real, server-owned object -- not a client-asserted string and not a fuzzy
-- time window. The id is MINTED SERVER-SIDE on the first turn and echoed back
-- by the client on later turns; the gate re-validates ownership and liveness
-- every time, so a client can neither invent an id nor keep a dead one alive.
--
-- Three bounds close a conversation (see billing_config):
--   turn cap   -- free: 12 turns. Hard stop; the user must start a new chat,
--                 which consumes another conversation from the monthly quota.
--   idle       -- 30 minutes with no turn.
--   max age    -- 24 hours from the first turn.
-- Together they make "hold one conversation open forever" impossible.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  anon_key_hash TEXT,
  plan TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_turn_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  turn_count INTEGER NOT NULL DEFAULT 0,
  closed_at TIMESTAMP WITH TIME ZONE,
  -- 'turn_cap' | 'idle' | 'max_age' | 'client'
  close_reason TEXT,
  CONSTRAINT chat_conversations_identity
    CHECK ((user_id IS NOT NULL) <> (anon_key_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_started
  ON chat_conversations (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_anon_started
  ON chat_conversations (anon_key_hash, started_at DESC);

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

-- Owner may read their own; every write is service-role / SECURITY DEFINER.
DROP POLICY IF EXISTS "Users can view their own conversations" ON chat_conversations;
CREATE POLICY "Users can view their own conversations"
  ON chat_conversations FOR SELECT
  USING (auth.uid() = user_id);

-- Link the existing ledger to conversations.
ALTER TABLE chat_usage_events
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES chat_conversations(id) ON DELETE SET NULL,
  -- What the spend rollup was charged at gate time, so backfilling real token
  -- costs can post an exact delta instead of double counting.
  ADD COLUMN IF NOT EXISTS assumed_cost_usd NUMERIC(10, 6);

CREATE INDEX IF NOT EXISTS idx_chat_usage_events_conversation
  ON chat_usage_events (conversation_id);

-- ---------------------------------------------------------------------------
-- 4. Free-tier spend rollup (circuit breaker) --------------------------------
-- Free users generate real Anthropic spend against zero revenue. Summing
-- est_cost_usd across every free user on every turn would be an unindexed
-- table scan, so the gate maintains one counter row per (month, scope) and the
-- breaker reads exactly that row.

CREATE TABLE IF NOT EXISTS chat_spend_rollup (
  period_month DATE NOT NULL,
  -- 'free' | 'anon' | 'premium' | any future plan key
  scope TEXT NOT NULL,
  turns BIGINT NOT NULL DEFAULT 0,
  credits BIGINT NOT NULL DEFAULT 0,
  est_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_month, scope)
);

-- RLS on, zero policies: service-role / SECURITY DEFINER only, same posture as
-- billing_events.
ALTER TABLE chat_spend_rollup ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. Operator-facing credit grants ------------------------------------------
-- chat_credit_grants already exists (top-ups, promo, support). Add an invoice
-- key so an operator can hand-grant against a specific Stripe invoice exactly
-- once. NOTE: the recurring $10/mo allowance does NOT flow through here -- it
-- comes from billing_plans.monthly_credits on a calendar-month basis, which is
-- interval-agnostic (a 12-month prepay still gets $10 each month) and cannot be
-- lost to a dropped webhook. See docs/payment-model.md §5.

ALTER TABLE chat_credit_grants
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_credit_grants_invoice
  ON chat_credit_grants (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Entitlement view --------------------------------------------------------
-- Column set changed, so this is a DROP + CREATE rather than CREATE OR REPLACE.

DROP VIEW IF EXISTS my_chat_entitlement;

CREATE VIEW my_chat_entitlement AS
SELECT
  u.id AS user_id,
  pl.plan,
  pl.display_name,
  pl.metering_mode,
  -- Conversation gate (free tier)
  pl.monthly_conversations,
  pl.daily_conversations,
  pl.conversation_turn_cap,
  COALESCE(conv_month.n, 0)::INTEGER AS conversations_used_this_month,
  COALESCE(conv_day.n, 0)::INTEGER AS conversations_used_today,
  CASE
    WHEN pl.monthly_conversations IS NULL THEN NULL
    ELSE GREATEST(pl.monthly_conversations - COALESCE(conv_month.n, 0), 0)::INTEGER
  END AS conversations_remaining_this_month,
  -- Credit gate (Premium)
  pl.monthly_credits,
  pl.credit_allowance_usd,
  pl.allow_deep_dive,
  COALESCE(month.used, 0)::INTEGER AS credits_used_this_month,
  COALESCE(grants.credits, 0)::INTEGER AS bonus_credits,
  GREATEST(
    pl.monthly_credits + COALESCE(grants.credits, 0) - COALESCE(month.used, 0),
    0
  )::INTEGER AS credits_remaining_this_month,
  ROUND(
    GREATEST(
      pl.monthly_credits + COALESCE(grants.credits, 0) - COALESCE(month.used, 0),
      0
    ) * billing_config_num('credit_unit_usd', 0.001),
    2
  ) AS credit_usd_remaining_this_month,
  -- What the plan actually sells in v2
  pl.includes_cabinet_memory,
  pl.includes_checkin_emails,
  pl.includes_surveys,
  pl.includes_referrals,
  -- Subscription state
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
  SELECT COUNT(*) AS n
  FROM chat_conversations c
  WHERE c.user_id = u.id
    AND c.started_at >= date_trunc('month', NOW())
) conv_month ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS n
  FROM chat_conversations c
  WHERE c.user_id = u.id
    AND c.started_at >= date_trunc('day', NOW())
) conv_day ON true
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

-- ---------------------------------------------------------------------------
-- 7. The gate ----------------------------------------------------------------
-- Called by the chat edge function with the service-role key, BEFORE it talks
-- to Anthropic. p_user_id is never trusted from the request body -- the edge
-- function resolves it from the verified JWT.
--
-- Replaces consume_chat_credits() from v1, which knew nothing about
-- conversations. The old function is left in place (harmless, unreferenced
-- once the chat function is updated) rather than dropped, so a partially
-- rolled-out deploy can't hit a missing-function error.
--
-- reason values:
--   ok
--   deep_dive_requires_premium
--   conversation_turn_limit        -- this chat is full; start a new one
--   monthly_conversation_limit     -- out of chats this month
--   daily_conversation_limit
--   monthly_credit_limit           -- Premium allowance spent
--   free_tier_budget_exhausted     -- global circuit breaker tripped
--   chat_not_available             -- plan has metering_mode = 'none'

CREATE OR REPLACE FUNCTION consume_chat_turn(
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
                 THEN 'anon'
                 ELSE billing_plan_for_user(p_user_id) END;
  SELECT * INTO v_row FROM billing_plans WHERE billing_plans.plan = v_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown plan %', v_plan;
  END IF;

  v_unit          := billing_config_num('credit_unit_usd', 0.001);
  v_assumed       := billing_config_num('assumed_turn_cost_usd', 0.009);
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

  IF v_row.metering_mode = 'none' THEN
    RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
      0, 0, 0::NUMERIC, 'chat_not_available'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF p_deep_dive AND NOT v_row.allow_deep_dive THEN
    RETURN QUERY SELECT false, v_plan, p_conversation_id, false, NULL::INTEGER,
      NULL::INTEGER, 0, 0::NUMERIC, 'deep_dive_requires_premium'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Global free-tier circuit breaker. Checked before anything is written, so a
  -- runaway month cannot be made worse by the check itself.
  IF v_row.metering_mode = 'conversations' THEN
    v_cap := billing_config_num('free_tier_monthly_usd_cap', 0);
    IF v_cap > 0 THEN
      SELECT COALESCE(SUM(est_cost_usd), 0) INTO v_spent
      FROM chat_spend_rollup
      WHERE period_month = v_period AND scope IN ('free', 'anon');
      IF v_spent >= v_cap THEN
        RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
          0, 0, 0::NUMERIC, 'free_tier_budget_exhausted'::TEXT, NULL::UUID;
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
    -- Turn cap: hard stop. Returning an error (rather than silently rolling
    -- into a new conversation) is deliberate -- rolling over would burn another
    -- conversation from the user's quota without them asking.
    IF v_row.conversation_turn_cap IS NOT NULL
       AND v_conv.turn_count >= v_row.conversation_turn_cap THEN
      UPDATE chat_conversations
        SET closed_at = NOW(), close_reason = 'turn_cap'
        WHERE id = v_conv.id;
      RETURN QUERY SELECT false, v_plan, v_conv.id, false, 0,
        NULL::INTEGER, 0, 0::NUMERIC, 'conversation_turn_limit'::TEXT, NULL::UUID;
      RETURN;
    END IF;

    -- Idle / age: close quietly and open a fresh conversation. The user walked
    -- away and came back, which genuinely is a new conversation.
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

  -- --- Conversation quota (free tier) --------------------------------------
  IF v_conv.id IS NULL THEN
    v_new_conv := true;

    IF v_row.monthly_conversations IS NOT NULL
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
          0, 0, 0::NUMERIC, 'monthly_conversation_limit'::TEXT, NULL::UUID;
        RETURN;
      END IF;

      IF v_row.daily_conversations IS NOT NULL
         AND v_conv_day >= v_row.daily_conversations THEN
        RETURN QUERY SELECT false, v_plan, NULL::UUID, false, NULL::INTEGER,
          GREATEST(COALESCE(v_row.monthly_conversations, 0) - v_conv_month, 0),
          0, 0::NUMERIC, 'daily_conversation_limit'::TEXT, NULL::UUID;
        RETURN;
      END IF;
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

  -- Only credit-metered plans are GATED on credits. Conversation-metered plans
  -- still record credits on every event (so cost analytics are uniform), but a
  -- zero allowance there means "not credit-gated", not "no chat".
  IF v_row.metering_mode = 'credits'
     AND v_month_used + v_credits > v_allowance THEN
    RETURN QUERY SELECT false, v_plan, COALESCE(v_conv.id, p_conversation_id),
      false, NULL::INTEGER, NULL::INTEGER, v_remaining,
      ROUND(v_remaining * v_unit, 2), 'monthly_credit_limit'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- --- Commit ---------------------------------------------------------------
  IF v_new_conv THEN
    INSERT INTO chat_conversations (user_id, anon_key_hash, plan, turn_count)
    VALUES (p_user_id, p_anon_key_hash, v_plan, 1)
    RETURNING * INTO v_conv;
    v_conv_month := v_conv_month + 1;
  ELSE
    UPDATE chat_conversations
      SET turn_count = turn_count + 1, last_turn_at = NOW()
      WHERE id = v_conv.id
      RETURNING * INTO v_conv;
  END IF;

  INSERT INTO chat_usage_events (
    user_id, anon_key_hash, credits, model, conversation_id, assumed_cost_usd
  )
  VALUES (
    p_user_id, p_anon_key_hash, v_credits, p_model, v_conv.id, v_assumed
  )
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
  v_turns_left := CASE
    WHEN v_row.conversation_turn_cap IS NULL THEN NULL
    ELSE GREATEST(v_row.conversation_turn_cap - v_conv.turn_count, 0)
  END;
  v_remaining := GREATEST(v_allowance - (v_month_used + v_credits), 0);

  RETURN QUERY SELECT
    true, v_plan, v_conv.id, v_new_conv, v_turns_left, v_conv_left,
    v_remaining, ROUND(v_remaining * v_unit, 2), 'ok'::TEXT, v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION consume_chat_turn(UUID, TEXT, UUID, TEXT, BOOLEAN, INTEGER)
  FROM anon, authenticated;

-- Backfill real token counts, and post the difference between real and assumed
-- cost onto the rollup so the circuit breaker converges on truth.
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

  IF NOT FOUND OR v_assumed IS NULL THEN
    RETURN;
  END IF;

  UPDATE chat_spend_rollup
  SET est_cost_usd = GREATEST(est_cost_usd + (p_est_cost_usd - v_assumed), 0),
      updated_at = NOW()
  WHERE period_month = v_period AND scope = v_scope;
END;
$$;

REVOKE ALL ON FUNCTION record_chat_usage_tokens(UUID, INTEGER, INTEGER, NUMERIC)
  FROM anon, authenticated;

-- Lets the client end a conversation explicitly ("New chat" button). Safe to
-- expose: it can only close a row the caller owns, and closing costs the
-- caller a conversation from their quota rather than saving them one.
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

-- ---------------------------------------------------------------------------
-- 8. Public plan catalog -----------------------------------------------------
-- What a pricing page needs, without the internal metering columns. Owner
-- rights (matching sss_*_ranked / public_favorites), filtered to public plans.

CREATE OR REPLACE VIEW billing_plans_public AS
SELECT
  plan,
  display_name,
  price_cents_monthly,
  price_cents_semiannual,
  price_cents_yearly,
  credit_allowance_usd,
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

-- ---------------------------------------------------------------------------
-- 9. One-time credit rescale -------------------------------------------------
-- v1 credits: 1 = one Haiku turn. v2 credits: 1 = $0.001 of user-facing value,
-- so one standard turn = 100. Any ledger rows written under v1 semantics are
-- multiplied by 100 exactly once, guarded by a marker key. In practice the
-- ledger is expected to be empty (v1 was never deployed), so this is belt and
-- braces rather than a real data migration.

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
