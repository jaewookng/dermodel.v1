-- Bella's memory: the user's cabinet, replenishment estimates, and check-ins.
--
-- The premise: the recurring value in this product is remembering what you own
-- and telling you when it's about to run out -- not chat volume. Everything
-- here is deterministic SQL over data we already have. No LLM is involved in
-- deciding when to email or what to recommend, exactly like `bella-hooks`.
--
-- Premium-only: `bella_checkin_candidates()` filters on billing_plan_for_user().
-- Free users keep their favorites forever, they just don't get check-ins.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Size parsing
-- ───────────────────────────────────────────────────────────────────────────
-- Product names in this dataset carry their size ("... Ampoule, 1.01 fl oz/30
-- mL"), so we can size a cabinet item without asking the user. Measured against
-- 600 live product names: 89% parse. The rest return NULL and the caller falls
-- back to asking -- never guess a size, a wrong one produces a wrong email.

CREATE OR REPLACE FUNCTION dermodel_parse_size_ml(p_name TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n TEXT := lower(coalesce(p_name, ''));
  m TEXT;
  v NUMERIC;
BEGIN
  -- Metric first: when a name lists both ("1.01 fl oz/30 mL") the mL figure is
  -- the exact one and the imperial one is the rounded marketing number.
  m := substring(n from '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:ml|milliliters?)(?![a-z])');
  IF m IS NOT NULL THEN
    v := m::numeric;
  ELSE
    -- Grams: treated 1 g = 1 mL. Fine for creams/balms (density ~1), and the
    -- estimate is already approximate; noted so nobody reads it as exact.
    m := substring(n from '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:g|grams?)(?![a-z])');
    IF m IS NOT NULL THEN
      v := m::numeric;
    ELSE
      m := substring(
        n from '([0-9]+(?:\.[0-9]+)?)[[:space:]]*(?:fl\.?[[:space:]]*oz\.?|fluid[[:space:]]+ounces?|oz\.?|ounces?)(?![a-z])'
      );
      IF m IS NULL THEN
        RETURN NULL;
      END IF;
      v := m::numeric * 29.5735;
    END IF;
  END IF;

  -- Sanity clamp: sub-millilitre and bulk-drum values are parse artefacts
  -- ("Pack of 10", "1 Count") more often than real product sizes.
  IF v < 1 OR v > 5000 THEN
    RETURN NULL;
  END IF;
  RETURN round(v, 2);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Typical dose per application
-- ───────────────────────────────────────────────────────────────────────────
-- Inferred from the product name, since we have no category column. These are
-- deliberately coarse: the output is "your serum runs out in about 3 weeks",
-- not a clinical measurement.
--
-- ⚠️ Known weak spot: count-based products (sheet masks, "Pack of 10") are sold
-- by unit, not volume, so a volume model fits them badly -- a 27 mL "Ampoule
-- Mask" is ONE sheet, not a 27 mL bottle. They're lumped at 5 mL/use so the
-- estimate is short rather than absurdly long, and dose_ml stays user-editable.

CREATE OR REPLACE FUNCTION dermodel_dose_ml(p_name TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_name,'')) ~ '(cleanser|cleansing|face wash|foam|micellar)' THEN 2.5
    WHEN lower(coalesce(p_name,'')) ~ '(toner|tonique|mist|astringent)'               THEN 2.0
    WHEN lower(coalesce(p_name,'')) ~ '(eye cream|eye serum|eye gel)'                 THEN 0.4
    -- Masks are checked BEFORE serums/ampoules: "Ampoule Mask" is a sheet mask,
    -- not an ampoule, and matching it as one badly overestimates how long it lasts.
    WHEN lower(coalesce(p_name,'')) ~ '(mask|pack of|sheet)'                          THEN 5.0
    WHEN lower(coalesce(p_name,'')) ~ '(essence|ampoule|serum|concentrate|booster)'   THEN 0.7
    WHEN lower(coalesce(p_name,'')) ~ '(sunscreen|sun cream|spf|sunblock)'            THEN 1.5
    WHEN lower(coalesce(p_name,'')) ~ '(body|hand|shampoo|conditioner)'               THEN 6.0
    WHEN lower(coalesce(p_name,'')) ~ '(moisturizer|cream|lotion|balm|butter|gel)'    THEN 1.2
    WHEN lower(coalesce(p_name,'')) ~ '(oil)'                                         THEN 1.0
    ELSE 1.2
  END;
$$;

-- How many times a routine runs per day. Applied ON TOP of the frequency, so a
-- product used every other day in both routines is 0.5 * 2 = 1 application/day.
CREATE OR REPLACE FUNCTION dermodel_routine_multiplier(p_routine TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_routine = 'both' THEN 2.0 ELSE 1.0 END;
$$;

-- Applications per day for each frequency the UI offers.
CREATE OR REPLACE FUNCTION dermodel_uses_per_day(p_frequency TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_frequency
    -- Retained so pre-existing rows keep resolving; the UI no longer offers it.
    WHEN 'twice_daily'     THEN 2.0
    WHEN 'daily'           THEN 1.0
    WHEN 'every_other_day' THEN 0.5
    WHEN 'weekly'          THEN 1.0/7.0
    WHEN 'as_needed'       THEN 0.3
    ELSE 1.0
  END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The cabinet
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cabinet_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES sss_products(product_id) ON DELETE CASCADE,
  opened_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  -- `frequency` is how OFTEN, `routine` is WHEN. The old 'twice_daily' value
  -- conflated the two -- it really meant "daily, in both routines" -- so it's
  -- retired in favour of frequency='daily' + routine='both'.
  frequency    TEXT NOT NULL DEFAULT 'daily'
               CHECK (frequency IN ('daily','every_other_day','weekly','as_needed')),
  routine      TEXT NOT NULL DEFAULT 'both'
               CHECK (routine IN ('am','pm','both')),
  -- Parsed from the product name on insert; user-editable when we get it wrong
  -- or the name carries no size.
  size_ml      NUMERIC CHECK (size_ml IS NULL OR (size_ml > 0 AND size_ml <= 5000)),
  dose_ml      NUMERIC CHECK (dose_ml IS NULL OR (dose_ml > 0 AND dose_ml <= 100)),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','finished','discarded')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id, opened_on)
);

CREATE INDEX IF NOT EXISTS idx_cabinet_items_user ON cabinet_items (user_id, status);

-- Fill size from the product name when the client didn't supply one.
CREATE OR REPLACE FUNCTION cabinet_items_fill_size()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.size_ml IS NULL THEN
    SELECT dermodel_parse_size_ml(p.product_name) INTO NEW.size_ml
    FROM sss_products p WHERE p.product_id = NEW.product_id;
  END IF;
  IF NEW.dose_ml IS NULL THEN
    SELECT dermodel_dose_ml(p.product_name) INTO NEW.dose_ml
    FROM sss_products p WHERE p.product_id = NEW.product_id;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cabinet_items_fill_size_trg ON cabinet_items;
CREATE TRIGGER cabinet_items_fill_size_trg
BEFORE INSERT OR UPDATE ON cabinet_items
FOR EACH ROW EXECUTE FUNCTION cabinet_items_fill_size();

ALTER TABLE cabinet_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own cabinet" ON cabinet_items;
CREATE POLICY "Users manage their own cabinet"
  ON cabinet_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Caller-scoped view with the replenishment estimate computed.
CREATE OR REPLACE VIEW my_cabinet AS
SELECT
  c.id,
  c.product_id,
  p.product_name,
  p.image_url,
  c.opened_on,
  c.frequency,
  c.routine,
  c.size_ml,
  c.dose_ml,
  c.status,
  CASE
    WHEN c.size_ml IS NULL OR c.dose_ml IS NULL THEN NULL
    ELSE GREATEST(1, ROUND(c.size_ml / (c.dose_ml * dermodel_uses_per_day(c.frequency)
                                       * dermodel_routine_multiplier(c.routine))))
  END AS days_supply,
  CASE
    WHEN c.size_ml IS NULL OR c.dose_ml IS NULL THEN NULL
    ELSE c.opened_on
       + (GREATEST(1, ROUND(c.size_ml / (c.dose_ml * dermodel_uses_per_day(c.frequency)
                                          * dermodel_routine_multiplier(c.routine)))))::INT
  END AS estimated_empty_on
FROM cabinet_items c
JOIN sss_products p ON p.product_id = c.product_id
WHERE c.user_id = auth.uid();

GRANT SELECT ON my_cabinet TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Email preferences
-- ───────────────────────────────────────────────────────────────────────────
-- Check-ins default ON per product decision, so every send MUST carry a
-- one-click unsubscribe. The token is what makes that work without a login.

-- Nullable and NOT defaulted: NULL means "never asked". A blanket DEFAULT TRUE
-- silently opts in users in consent_first regions (GDPR/PECR/CASL), which is
-- exactly the thing consent law is about. The effective answer is resolved by
-- dermodel_checkin_emails_allowed() in 20260824_billing_regions.sql, which
-- combines this column with the region default and the consent log.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS checkin_emails_enabled BOOLEAN;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_token ON profiles (email_token);

-- Consent gate placeholder.
--
-- The real, region-aware implementation lives in 20260824_billing_regions.sql
-- and CREATE OR REPLACEs this one (same signature). It's defined here because
-- bella_checkin_candidates() below calls it, and Postgres validates SQL
-- function bodies at creation time -- so without a stub this migration cannot
-- be applied before 20260824.
--
-- The stub fails CLOSED: NULL (never asked) means do not email. Under-sending
-- while the region policy isn't loaded yet is the safe direction to be wrong in.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'dermodel_checkin_emails_allowed' AND n.nspname = 'public'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION dermodel_checkin_emails_allowed(p_user_id UUID)
      RETURNS BOOLEAN
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $body$
        SELECT COALESCE(
          (SELECT p.checkin_emails_enabled FROM profiles p WHERE p.id = p_user_id),
          FALSE
        );
      $body$;
    $fn$;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Check-in log + survey
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bella_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cabinet_item_id UUID NOT NULL REFERENCES cabinet_items(id) ON DELETE CASCADE,
  survey_token    UUID NOT NULL DEFAULT gen_random_uuid(),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at    TIMESTAMPTZ,
  -- One check-in per item per cycle. This is the idempotency guard that stops a
  -- retried or double-scheduled cron run from emailing the same person twice.
  cycle_key       TEXT NOT NULL,
  UNIQUE (cabinet_item_id, cycle_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bella_checkins_survey_token
  ON bella_checkins (survey_token);

ALTER TABLE bella_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own check-ins" ON bella_checkins;
CREATE POLICY "Users can view their own check-ins"
  ON bella_checkins FOR SELECT
  USING (auth.uid() = user_id);
-- Writes are service-role only (the cron function); no INSERT/UPDATE policy.

CREATE TABLE IF NOT EXISTS checkin_survey_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id        UUID NOT NULL UNIQUE REFERENCES bella_checkins(id) ON DELETE CASCADE,
  skin_rating       SMALLINT CHECK (skin_rating BETWEEN 1 AND 5),
  product_rating    SMALLINT CHECK (product_rating BETWEEN 1 AND 5),
  would_repurchase  BOOLEAN,
  notes             TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE checkin_survey_responses ENABLE ROW LEVEL SECURITY;
-- Responses arrive from an emailed link with no session, so they're written by
-- the `bella-survey` function with the service role after it validates the
-- token. Users can read back their own.
DROP POLICY IF EXISTS "Users can view their own survey responses" ON checkin_survey_responses;
CREATE POLICY "Users can view their own survey responses"
  ON checkin_survey_responses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM bella_checkins c
    WHERE c.id = checkin_id AND c.user_id = auth.uid()
  ));

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Who is due for a check-in
-- ───────────────────────────────────────────────────────────────────────────
-- Called by the `bella-checkin` cron function with the service role. Premium
-- gate lives here rather than in the function so it can't be forgotten at the
-- call site.

CREATE OR REPLACE FUNCTION bella_checkin_candidates(p_lead_days INT DEFAULT 7)
RETURNS TABLE (
  cabinet_item_id UUID,
  user_id         UUID,
  email           TEXT,
  username        TEXT,
  email_token     UUID,
  product_id      TEXT,
  product_name    TEXT,
  opened_on       DATE,
  days_supply     INT,
  estimated_empty_on DATE,
  cycle_key       TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.user_id,
    pr.email,
    pr.username,
    pr.email_token,
    c.product_id,
    p.product_name,
    c.opened_on,
    supply.days_supply::INT,
    (c.opened_on + supply.days_supply::INT) AS estimated_empty_on,
    to_char(c.opened_on + supply.days_supply::INT, 'YYYY-MM-DD') AS cycle_key
  FROM cabinet_items c
  JOIN sss_products p ON p.product_id = c.product_id
  JOIN profiles pr    ON pr.id = c.user_id
  CROSS JOIN LATERAL (
    SELECT GREATEST(1, ROUND(c.size_ml / (c.dose_ml * dermodel_uses_per_day(c.frequency)
                                          * dermodel_routine_multiplier(c.routine)))) AS days_supply
  ) supply
  WHERE c.status = 'active'
    AND c.size_ml IS NOT NULL
    AND c.dose_ml IS NOT NULL
    -- Region-aware: combines the user's own answer, the region default, and the
    -- append-only consent log. Never send on the raw column alone.
    AND dermodel_checkin_emails_allowed(c.user_id)
    AND pr.email IS NOT NULL
    -- Paid plans only. Written as an exclusion rather than `= 'premium'` so a
    -- plan rename (plus -> premium happened once already) can't silently switch
    -- every subscriber's check-ins off.
    AND billing_plan_for_user(c.user_id) NOT IN ('free', 'anon')
    -- Inside the lead window, and not past due by more than a fortnight (a
    -- months-stale item means they stopped using it, not that they need a nudge).
    AND CURRENT_DATE >= (c.opened_on + supply.days_supply::INT) - p_lead_days
    AND CURRENT_DATE <= (c.opened_on + supply.days_supply::INT) + 14
    AND NOT EXISTS (
      SELECT 1 FROM bella_checkins b
      WHERE b.cabinet_item_id = c.id
        AND b.cycle_key = to_char(c.opened_on + supply.days_supply::INT, 'YYYY-MM-DD')
    );
$$;

REVOKE ALL ON FUNCTION bella_checkin_candidates(INT) FROM PUBLIC, anon, authenticated;
