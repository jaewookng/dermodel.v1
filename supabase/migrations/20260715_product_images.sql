-- Product images: hotlinked from the SkinSafe CDN (the source of the sss.csv
-- dataset), seeded once by scripts/import_skinsafe_images.py.
--
-- Images are NOT copied or proxied — sss_products.image_url points at the
-- origin server (server-test posture) and the frontend renders it with
-- referrerpolicy="no-referrer" plus a visible source credit built from the
-- columns below.

ALTER TABLE sss_products
  ADD COLUMN IF NOT EXISTS image_source_url TEXT,   -- source product page (link-back credit)
  ADD COLUMN IF NOT EXISTS image_attribution TEXT;  -- source domain, e.g. 'skinsafeproducts.com'

-- Expose image fields through the ranked view the frontend reads.
-- New columns are appended AFTER like_count: CREATE OR REPLACE VIEW can only
-- add columns at the end of the existing column list (the 20260603 view ends
-- at like_count), and the frontend selects by name so order is irrelevant.
CREATE OR REPLACE VIEW sss_products_ranked AS
SELECT
  product_id,
  product_name,
  ingredient_count,
  image_url,
  like_count,
  image_source_url,
  image_attribution
FROM sss_products;
