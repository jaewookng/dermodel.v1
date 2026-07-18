-- Shareable favorites: opt-in public profile page at /u/<user_id>.
--
-- profiles.favorites_public is flipped on when the user clicks Share on the
-- Favorites page (and can be turned back off). The public_favorites view is
-- the ONLY read path for other visitors: it runs with owner rights (default
-- security_invoker = false, same pattern as the sss_*_ranked views) so it can
-- bypass the per-user RLS on product_favorites/profiles, but it joins on
-- favorites_public = true and exposes only username + product data — never
-- email or any other profile field.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS favorites_public BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public_favorites AS
SELECT
  pf.user_id,
  pr.username,
  pf.product_id,
  p.product_name,
  p.ingredient_count,
  p.image_url,
  p.image_source_url,
  p.image_attribution,
  pf.created_at
FROM product_favorites pf
JOIN profiles pr ON pr.id = pf.user_id AND pr.favorites_public
JOIN sss_products p ON p.product_id = pf.product_id;

GRANT SELECT ON public_favorites TO anon, authenticated;
