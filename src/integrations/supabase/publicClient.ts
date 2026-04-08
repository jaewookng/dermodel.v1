import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://dolkstgbyfozbetxyrby.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvbGtzdGdieWZvemJldHh5cmJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3OTYwODgsImV4cCI6MjA1NzM3MjA4OH0.bib8VxB-jFP6hslqyKHX5IL28mLryTH0d6nKTe_dZpM";

// Public client avoids auth/session churn during data fetches.
export const supabasePublic = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
