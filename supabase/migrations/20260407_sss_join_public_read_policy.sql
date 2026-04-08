-- Allow public read access to sss_product_ingredients_join for anon/authenticated users.

ALTER TABLE sss_product_ingredients_join ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access" ON sss_product_ingredients_join;
CREATE POLICY "Allow read access"
  ON sss_product_ingredients_join
  FOR SELECT
  TO anon, authenticated
  USING (true);
