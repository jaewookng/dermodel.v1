-- Security hardening: pin search_path on existing functions.
--
-- handle_new_user() is SECURITY DEFINER; without a fixed search_path a caller
-- who can create objects in a schema earlier on the path could hijack the
-- unqualified table references (Supabase linter: function_search_path_mutable).
-- update_profiles_updated_at() is pinned too for the same linter warning.
-- sss_apply_favorite_counts() (20260603) already sets it at creation.

ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.update_profiles_updated_at() SET search_path = public;
