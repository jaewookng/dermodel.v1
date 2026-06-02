-- Core product/ingredient tables (sss_* dataset)

CREATE TABLE IF NOT EXISTS sss_ingredients (
  ingredient_id TEXT PRIMARY KEY,
  ingredient_name TEXT,
  product_count BIGINT,
  avg_position DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS sss_products (
  product_id TEXT PRIMARY KEY,
  product_name TEXT,
  ingredient_count BIGINT,
  image_url TEXT,
  image_fetched_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS sss_product_ingredients_join (
  product_id TEXT NOT NULL REFERENCES sss_products(product_id),
  ingredient_id TEXT NOT NULL REFERENCES sss_ingredients(ingredient_id),
  position BIGINT,
  PRIMARY KEY (product_id, ingredient_id)
);

-- Indexes to speed up join-table lookups in both directions
CREATE INDEX IF NOT EXISTS idx_sss_join_ingredient_id
  ON sss_product_ingredients_join(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_sss_join_product_id
  ON sss_product_ingredients_join(product_id);
