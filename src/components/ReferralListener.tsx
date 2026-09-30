import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'dermodel:ref';

/**
 * Captures `?ref=<code>` from any URL and claims it once the visitor has an
 * account. The code sits in localStorage across the OAuth round-trip, and the
 * claim goes through `claim_referral()`, which decides whether it counts —
 * the client never grants anything itself. Renders nothing.
 */
export function ReferralListener() {
  const location = useLocation();
  const { session, loading } = useAuth();
  const claiming = useRef(false);

  useEffect(() => {
    const code = new URLSearchParams(location.search).get('ref');
    if (!code) return;
    try {
      localStorage.setItem(STORAGE_KEY, code.trim().toLowerCase());
    } catch {
      /* storage blocked — the link still works, the referral just won't stick */
    }
  }, [location.search]);

  useEffect(() => {
    if (loading || !session || claiming.current) return;
    let code: string | null = null;
    try {
      code = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!code) return;
    claiming.current = true;

    (async () => {
      const { data, error } = await supabase.rpc('claim_referral', { p_code: code });
      // Whatever happened, don't retry on every route change. A claim that
      // failed for a reason the user can't fix ('too_old', 'invalid_code') is
      // just dropped; the server is the source of truth.
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      claiming.current = false;
      if (error) return;
      const result = data?.[0];
      if (result?.status === 'granted' || result?.status === 'referrer_capped') {
        const until = result.comp_until
          ? new Date(result.comp_until).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
            })
          : null;
        toast.success(
          until ? `You've got Premium free until ${until}` : "You've got a week of Premium",
          { description: 'Your cabinet, check-ins, and Bella are all unlocked.' }
        );
      }
    })();
  }, [session, loading]);

  return null;
}
