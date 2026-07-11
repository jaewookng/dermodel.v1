-- User-submitted product suggestions, reviewed by an admin before being added
-- to sss_products. The client inserts directly (so submissions are captured
-- even if the notification edge function is down); an edge function sends the
-- email notification to admin@dermodel.app as a best-effort side channel.

CREATE TABLE IF NOT EXISTS product_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_url TEXT NOT NULL CHECK (char_length(product_url) BETWEEN 1 AND 2048),
  product_name TEXT CHECK (char_length(product_name) <= 200),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE product_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone (logged in or not) can submit; user_id may only be their own.
-- No SELECT/UPDATE/DELETE policies: submissions are reviewed via the
-- Supabase dashboard, not exposed to clients.
DROP POLICY IF EXISTS "Anyone can submit products" ON product_submissions;
CREATE POLICY "Anyone can submit products"
  ON product_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
