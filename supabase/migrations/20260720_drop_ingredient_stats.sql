-- Drop ingredient_stats: a hand-created (pre-migration-history) relation
-- duplicating sss_ingredients_ranked minus like_count. Verified 2026-07-20:
-- same 21,192 rows / same values as sss_ingredients, zero references in the
-- app, scripts, or migrations — and it was GRANTed to anon for no reason.
--
-- DO block because it isn't in any migration, so its kind (view / matview /
-- table) isn't pinned down; handles all three idempotently.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_views
             WHERE schemaname = 'public' AND viewname = 'ingredient_stats') THEN
    EXECUTE 'DROP VIEW public.ingredient_stats';
  ELSIF EXISTS (SELECT FROM pg_matviews
                WHERE schemaname = 'public' AND matviewname = 'ingredient_stats') THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.ingredient_stats';
  ELSIF EXISTS (SELECT FROM pg_tables
                WHERE schemaname = 'public' AND tablename = 'ingredient_stats') THEN
    EXECUTE 'DROP TABLE public.ingredient_stats';
  END IF;
END $$;
