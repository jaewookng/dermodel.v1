-- Performance: replace the per-query aggregation in sss_*_ranked with real,
-- indexed like_count columns maintained incrementally by triggers.
--
-- Before this, sss_products_ranked / sss_ingredients_ranked computed like_count
-- via COUNT(*) + GROUP BY + LEFT JOIN on every read, and ORDER BY like_count
-- could not use an index (the column was computed per-query) -- so each request
-- aggregated all of product_favorites and full-sorted the whole table. Loading
-- the entire product list this way was significantly slower.
--
-- Now like_count is a denormalized column on sss_products / sss_ingredients,
-- kept in sync by an AFTER INSERT/DELETE trigger on product_favorites, and
-- backed by an index that matches the default popularity ordering. The ranked
-- views become simple pass-throughs so the planner uses the index.

-- 1. Denormalized counters ---------------------------------------------------
ALTER TABLE sss_products
  ADD COLUMN IF NOT EXISTS like_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sss_ingredients
  ADD COLUMN IF NOT EXISTS like_count BIGINT NOT NULL DEFAULT 0;

-- Indexes matching the ORDER BY used by the app (popularity first, then the
-- existing tiebreaker) so ordering + pagination are index-backed.
CREATE INDEX IF NOT EXISTS idx_sss_products_like_count
  ON sss_products (like_count DESC, product_name ASC);
CREATE INDEX IF NOT EXISTS idx_sss_ingredients_like_count
  ON sss_ingredients (like_count DESC, product_count DESC);

-- Helps the backfill and is generally useful for product_id lookups.
CREATE INDEX IF NOT EXISTS idx_product_favorites_product_id
  ON product_favorites (product_id);

-- 2. Backfill current counts -------------------------------------------------
UPDATE sss_products p
SET like_count = COALESCE(c.cnt, 0)
FROM (
  SELECT product_id, COUNT(*) AS cnt
  FROM product_favorites
  GROUP BY product_id
) c
WHERE c.product_id = p.product_id;

UPDATE sss_ingredients i
SET like_count = COALESCE(c.cnt, 0)
FROM (
  SELECT j.ingredient_id, COUNT(*) AS cnt
  FROM product_favorites pf
  JOIN sss_product_ingredients_join j ON j.product_id = pf.product_id
  GROUP BY j.ingredient_id
) c
WHERE c.ingredient_id = i.ingredient_id;

-- 3. Incremental maintenance trigger ----------------------------------------
-- SECURITY DEFINER so it can update the sss_ tables (which only expose SELECT
-- to anon/authenticated via RLS) regardless of which user toggled the like.
CREATE OR REPLACE FUNCTION sss_apply_favorite_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE sss_products
      SET like_count = like_count + 1
      WHERE product_id = NEW.product_id;
    UPDATE sss_ingredients
      SET like_count = like_count + 1
      WHERE ingredient_id IN (
        SELECT ingredient_id FROM sss_product_ingredients_join
        WHERE product_id = NEW.product_id
      );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE sss_products
      SET like_count = GREATEST(like_count - 1, 0)
      WHERE product_id = OLD.product_id;
    UPDATE sss_ingredients
      SET like_count = GREATEST(like_count - 1, 0)
      WHERE ingredient_id IN (
        SELECT ingredient_id FROM sss_product_ingredients_join
        WHERE product_id = OLD.product_id
      );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_favorite_counts ON product_favorites;
CREATE TRIGGER trg_favorite_counts
  AFTER INSERT OR DELETE ON product_favorites
  FOR EACH ROW EXECUTE FUNCTION sss_apply_favorite_counts();

-- 4. Ranked views become thin pass-throughs ---------------------------------
-- Same output columns/order as before, so no frontend change and existing
-- GRANTs are preserved. Ordering now resolves to the base-table indexes above.
CREATE OR REPLACE VIEW sss_ingredients_ranked AS
SELECT
  ingredient_id,
  ingredient_name,
  product_count,
  avg_position,
  like_count
FROM sss_ingredients;

CREATE OR REPLACE VIEW sss_products_ranked AS
SELECT
  product_id,
  product_name,
  ingredient_count,
  image_url,
  like_count
FROM sss_products;
