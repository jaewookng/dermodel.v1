// Supabase connection config. The anon (publishable) key is safe to ship to
// browsers — data access is enforced by RLS — but reading it from env vars
// makes key rotation a .env edit instead of a source change, and allows
// pointing at a staging project.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://dolkstgbyfozbetxyrby.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_TRmXc4W8v9WG5qMigv5Ttw_WA57pLc7";
