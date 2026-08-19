-- Stripe price ids for the Premium plan.
--
-- These live in `billing_plans`, not in code: `create-checkout-session` reads
-- them at request time, so changing a price is an UPDATE rather than a
-- redeploy.
--
-- ⚠️ STRIPE TEST AND LIVE MODE HAVE SEPARATE PRICE OBJECTS WITH DIFFERENT IDS.
-- The ids below are whatever mode they were created in. When you flip Stripe to
-- live mode you must re-run this UPDATE with the live ids, or checkout will
-- fail with "No such price" against the live secret key. The id format is
-- identical in both modes, so nothing here can detect the mismatch for you --
-- verify in the Stripe dashboard that the mode matches your STRIPE_SECRET_KEY.

UPDATE billing_plans
SET
  stripe_price_id_monthly    = 'price_1U6FKsKzUdCzDoBWKKCi2rN9',  -- $8.99 / month
  stripe_price_id_semiannual = 'price_1U6FKsKzUdCzDoBWvIwddHpv',  -- $48.54 / 6 months
  stripe_price_id_yearly     = 'price_1U6FKsKzUdCzDoBWCc8DjpZk'   -- $91.68 / year
WHERE plan = 'premium';

DO $$
DECLARE
  v_rows INT;
BEGIN
  SELECT count(*) INTO v_rows
  FROM billing_plans
  WHERE plan = 'premium' AND stripe_price_id_monthly IS NOT NULL;

  IF v_rows = 0 THEN
    RAISE EXCEPTION
      'No premium plan row was updated. Apply 20260821/20260824 first.';
  END IF;
  RAISE NOTICE 'Stripe price ids set on the premium plan.';
END $$;
