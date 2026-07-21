-- Share links by username: /u/<username> instead of /u/<user_id>.
--
-- The public_favorites view already exposes username, so the frontend can
-- look up by either. What the DB must guarantee is that a username maps to
-- exactly ONE user — otherwise two same-named users who both enabled sharing
-- would merge on one page.

-- 1. Dedupe existing usernames (case-insensitive; keeps the oldest as-is,
--    renames later ones with a numeric suffix).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY lower(username)
           ORDER BY created_at, id
         ) AS rn
  FROM profiles
  WHERE username IS NOT NULL
)
UPDATE profiles p
SET username = p.username || '-' || r.rn
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

-- 2. Enforce uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_ci
  ON profiles (lower(username))
  WHERE username IS NOT NULL;

-- 3. Collision-safe signup: handle_new_user picks the next free suffix
--    instead of violating the index (which would break account creation).
--    Keeps SECURITY DEFINER + pinned search_path from 20260706.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT := 0;
BEGIN
  base := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(candidate)) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;

  INSERT INTO public.profiles (id, email, username, avatar_url)
  VALUES (NEW.id, NEW.email, candidate, NEW.raw_user_meta_data->>'avatar_url');
  RETURN NEW;
END;
$$;
