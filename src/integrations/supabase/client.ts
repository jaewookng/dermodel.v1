import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});