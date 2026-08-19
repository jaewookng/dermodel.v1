-- SECURITY FIX: privileged functions were callable by anon.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- `REVOKE ... FROM anon, authenticated` does NOT remove that default grant --
-- both roles still inherit EXECUTE through PUBLIC. Several SECURITY DEFINER
-- functions in 20260818/20260821/20260824 were revoked that way and were
-- therefore still reachable with nothing but the publishable key.
--
-- Verified against production on 2026-08-19 before this fix:
--   consume_chat_turn        -> 200 (started a conversation, consumed allowance)
--   billing_region_for_user  -> 200 (disclosed another user's region policy)
--   chat_identity_key        -> 200
--   email_consent_state      -> 200
--
-- Worst of it is the WRITE functions: set_billing_country / set_declared_country
-- would let anyone move another user's region (bypassing or forcing region
-- gating), record_chat_usage_tokens would let anyone falsify usage and cost
-- accounting, and consume_chat_turn would let anyone burn a specific user's
-- conversation allowance.
--
-- The correct incantation is REVOKE ... FROM PUBLIC. This migration does that
-- for every privileged function by name, across all overloads, then re-grants
-- EXECUTE to service_role (the secret-key role the edge functions use).
--
-- The three client-callable RPCs in the frontend contract (payment-model §12.4)
-- are deliberately NOT in this list and keep their grants:
--   record_email_consent, set_my_declared_country, close_my_chat_conversation,
--   region_policy_for_country

DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN (
        'consume_chat_turn',
        'consume_chat_credits',
        'record_chat_usage_tokens',
        'chat_identity_key',
        'chat_absorb_anon_identity',
        'billing_region_for_user',
        'set_declared_country',
        'set_billing_country',
        'email_consent_state',
        'dermodel_checkin_emails_allowed',
        'bella_checkin_candidates'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Locked down % privileged function(s).', n;
END $$;

-- ── Re-grant what `my_chat_entitlement` needs ──────────────────────────────
-- Postgres checks function EXECUTE against the CALLING user even inside an
-- owner-rights (security_invoker = false) view -- owner-rights only covers
-- table access. my_chat_entitlement is the single read the whole frontend
-- depends on (payment-model §12.1), and it calls these five helpers, so
-- `authenticated` must retain EXECUTE on them or every signed-in user gets
-- "permission denied for function chat_identity_key" instead of their plan.
--
-- Accepted tradeoff: a signed-in user can call these with someone else's
-- user_id and learn that user's plan, region policy, consent state, or salted
-- identity key. That is unchanged from before this migration (they were
-- world-callable), and none of them WRITE. The dangerous writes --
-- consume_chat_turn, set_billing_country, set_declared_country,
-- record_chat_usage_tokens, chat_absorb_anon_identity -- stay locked to
-- service_role. Narrowing these five further means restructuring the view to
-- inline their logic; worth doing, but not in a security hotfix.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN (
        'chat_identity_key', 'dermodel_checkin_emails_allowed',
        'billing_region_for_user', 'email_consent_state', 'billing_plan_for_user'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

-- Belt and braces: stop the same hole reappearing for functions created later
-- in this schema by this role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
