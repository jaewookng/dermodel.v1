-- Allow public read access to sss_ingredients and sss_products for anon/authenticated users.

ALTER TABLE sss_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sss_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access" ON sss_ingredients;
CREATE POLICY "Allow read access"
  ON sss_ingredients
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow read access" ON sss_products;
CREATE POLICY "Allow read access"
  ON sss_products
  FOR SELECT
  TO anon, authenticated
  USING (true);
