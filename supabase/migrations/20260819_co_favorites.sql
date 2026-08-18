-- Co-favorite pairs: "people who liked A also liked B".
--
-- Powers Bella's "here's what other people using X also liked" opening hook.
-- Like sss_products_ranked / sss_ingredients_ranked, this view runs with the
-- default security_invoker = false so it aggregates across EVERY user's
-- favorites despite the per-user RLS on product_favorites. Only the aggregate
-- pair count is exposed -- no user_id, no per-user rows, and the pair itself
-- says nothing about who made it.
--
-- Privacy note: at very low user counts a co_count of 1 is a weak signal about
-- a single person's basket. Callers should require co_count >= 2 once the user
-- base is large enough to support it; the view exposes the count so that
-- threshold is a caller-side policy decision rather than a schema change.

CREATE OR REPLACE VIEW sss_co_favorites AS
SELECT
  a.product_id       AS product_id,
  b.product_id       AS also_product_id,
  COUNT(*)::BIGINT   AS co_count
FROM product_favorites a
JOIN product_favorites b
  ON b.user_id = a.user_id
 AND b.product_id <> a.product_id
GROUP BY a.product_id, b.product_id;

-- Supports the self-join above and the per-user favorites read.
CREATE INDEX IF NOT EXISTS idx_product_favorites_user_id
  ON product_favorites (user_id);

-- Bella's opening hooks are shown to logged-out visitors too.
GRANT SELECT ON sss_co_favorites TO anon, authenticated;
