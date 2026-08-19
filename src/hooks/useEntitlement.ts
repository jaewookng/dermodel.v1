import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type Entitlement = Database['public']['Views']['my_chat_entitlement']['Row'];

/**
 * The exact label rendered next to the check-in toggle.
 *
 * This string is stored verbatim in the consent log as proof of what the user
 * was shown, so it must stay identical to what's on screen. Change the wording
 * and you change the record — bump `CHECKIN_CONSENT_VERSION` at the same time.
 */
export const CHECKIN_CONSENT_TEXT =
  'Email me when a product I own is running low.';
export const CHECKIN_CONSENT_VERSION = 'checkin-v1';

/**
 * Billing entitlement for the signed-in user — the single read defined by the
 * billing integration contract (docs/payment-model.md §12.1).
 *
 * The view self-filters on auth.uid() and returns zero rows when signed out,
 * so there's no user id to pass and no way to read anyone else's.
 */
export const useEntitlement = () => {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? session?.user?.id ?? null;

  const query = useQuery({
    queryKey: ['entitlement', userId],
    queryFn: async (): Promise<Entitlement | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('my_chat_entitlement')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  /**
   * Records check-in email consent.
   *
   * Deliberately goes through the RPC rather than updating
   * profiles.checkin_emails_enabled directly: in consent_first regions the
   * column alone does NOT enable sending — the server requires a logged consent
   * event, and a direct write silently does nothing. Verified against the real
   * gate in Postgres.
   */
  const setCheckinConsent = useMutation({
    mutationFn: async (granted: boolean) => {
      const { error } = await supabase.rpc('record_email_consent', {
        p_action: granted ? 'granted' : 'withdrawn',
        p_method: 'settings_toggle',
        p_consent_text: CHECKIN_CONSENT_TEXT,
        p_consent_version: CHECKIN_CONSENT_VERSION,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entitlement', userId] });
    },
  });

  const e = query.data ?? null;

  return {
    entitlement: e,
    loading: query.isLoading,
    /** The billing tables may not be deployed yet — treat that as "no data". */
    unavailable: !!query.error,
    isPremium: e?.plan === 'premium',
    /** False ⇒ render no purchase path at all (region policy). */
    canBuy: e?.sell_premium !== false,
    upgradePrompt: (e?.upgrade_prompt ?? 'none') as 'none' | 'soft' | 'hard',
    conversationsRemaining: e?.conversations_remaining_lifetime ?? null,
    /** 'lifetime' must never render as "this month". */
    allowanceScope: e?.conversation_allowance_scope ?? 'none',
    setCheckinConsent,
  };
};
