-- Generic "has this user seen this feature announcement?" tracking.
--
-- One text[] column rather than a boolean per feature: every future
-- announcement is a new string key, never a new migration. Marking a feature
-- seen is an ordinary self-update through the existing
-- "Users can update their own profile" RLS policy, so no new policy is needed.
--
-- Convention for keys: lowercase, underscore-separated, and stable forever once
-- shipped (changing a key re-shows the announcement to everyone). In use:
--   'bella_intro'  -- the spotlight introducing Bella AI (2026-08-20)
--
-- Signed-out visitors have no profile row; the client falls back to
-- localStorage for them (see src/hooks/useFeatureSeen.ts).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS features_seen TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN profiles.features_seen IS
  'Keys of feature announcements this user has dismissed. Append-only; see src/hooks/useFeatureSeen.ts.';
