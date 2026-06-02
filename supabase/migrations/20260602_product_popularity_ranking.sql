-- Global product popularity ranking based on users' liked products.
--
-- popularity (like_count) = number of product_favorites entries, across ALL
-- users, for the product. Like sss_ingredients_ranked, this view runs with the
-- default security_invoker = false so it aggregates over every user's favorites
-- despite the per-user RLS on product_favorites. Only the aggregate count is
-- exposed -- no user_id or per-user data leaves the database.

CREATE OR REPLACE VIEW sss_products_ranked AS
SELECT
  p.product_id,
  p.product_name,
  p.ingredient_count,
  p.image_url,
  COALESCE(fav.like_count, 0) AS like_count
FROM sss_products p
LEFT JOIN (
  SELECT product_id, COUNT(*) AS like_count
  FROM product_favorites
  GROUP BY product_id
) fav ON fav.product_id = p.product_id;

-- Anon + authenticated need read access; the product list loads via the public
-- (anon) client, so logged-out visitors also see global popularity.
GRANT SELECT ON sss_products_ranked TO anon, authenticated;
