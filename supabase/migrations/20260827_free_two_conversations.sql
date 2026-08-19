-- Free tier: 5 -> 2 lifetime conversations (owner decision, 2026-08-19).
--
-- "Everyone gets two free chats." Anon was already 2; this brings the
-- signed-in free tier in line, so creating an account no longer buys extra
-- conversations on its own.
--
-- ⚠️ Consequence worth knowing: this is a LIFETIME counter, so anyone who has
-- already used 2+ conversations is immediately at the wall. Existing free users
-- who were part-way through their 5 will hit `lifetime_conversation_limit` on
-- their next turn. Use `chat_lifetime_conversations.bonus_conversations` to
-- grant individuals more if that generates complaints.

UPDATE billing_plans
SET lifetime_conversations = 2
WHERE plan = 'free';

DO $$
DECLARE
  v_free INT;
  v_anon INT;
BEGIN
  SELECT lifetime_conversations INTO v_free FROM billing_plans WHERE plan = 'free';
  SELECT lifetime_conversations INTO v_anon FROM billing_plans WHERE plan = 'anon';
  IF v_free IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'free plan lifetime_conversations is %, expected 2', v_free;
  END IF;
  RAISE NOTICE 'Free tier: % lifetime conversations (anon: %).', v_free, v_anon;
END $$;
