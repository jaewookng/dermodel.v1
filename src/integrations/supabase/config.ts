// Supabase connection config. The anon (publishable) key is safe to ship to
// browsers — data access is enforced by RLS — but reading it from env vars
// makes key rotation a .env edit instead of a source change, and allows
// pointing at a staging project.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://dolkstgbyfozbetxyrby.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvbGtzdGdieWZvemJldHh5cmJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3OTYwODgsImV4cCI6MjA1NzM3MjA4OH0.bib8VxB-jFP6hslqyKHX5IL28mLryTH0d6nKTe_dZpM";
