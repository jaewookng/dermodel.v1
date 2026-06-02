-- Global ingredient popularity ranking based on users' liked products.
--
-- popularity (like_count) = number of product_favorites entries, across ALL
-- users, whose product contains the ingredient. The view is owned by the
-- migration role and runs with the default security_invoker = false, so it
-- aggregates over every user's favorites despite the per-user RLS on
-- product_favorites. Only the aggregate count is exposed -- no user_id or any
-- per-user data leaves the database, so this is safe to read publicly.

CREATE OR REPLACE VIEW sss_ingredients_ranked AS
SELECT
  i.ingredient_id,
  i.ingredient_name,
  i.product_count,
  i.avg_position,
  COALESCE(pop.like_count, 0) AS like_count
FROM sss_ingredients i
LEFT JOIN (
  SELECT j.ingredient_id, COUNT(*) AS like_count
  FROM product_favorites pf
  JOIN sss_product_ingredients_join j ON j.product_id = pf.product_id
  GROUP BY j.ingredient_id
) pop ON pop.ingredient_id = i.ingredient_id;

-- Anon + authenticated need read access; the ingredient table loads via the
-- public (anon) client, so logged-out visitors also see global popularity.
GRANT SELECT ON sss_ingredients_ranked TO anon, authenticated;
