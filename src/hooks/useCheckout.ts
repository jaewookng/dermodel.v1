import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type CheckoutInterval = 'monthly' | 'semiannual' | 'yearly';

/**
 * Starts Stripe Checkout, or opens the billing portal.
 *
 * The region gate is enforced server-side, so a 403 `region_unavailable` is a
 * real possible outcome even when the client believed it could sell — the
 * entitlement view can be stale. It is handled separately from a generic
 * failure because it is not something the user can retry out of, and telling
 * them to try again would be a lie (docs/payment-model.md §12.6).
 */
export const useCheckout = () => {
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async (
      mode: 'subscription' | 'payment' | 'portal' = 'subscription',
      interval: CheckoutInterval = 'monthly'
    ) => {
      if (busy) return;
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          'create-checkout-session',
          {
            body:
              mode === 'subscription'
                ? { mode, plan: 'premium', interval }
                : { mode },
          }
        );

        if (error) {
          const res = (error as { context?: Response }).context;
          if (res && typeof res.json === 'function' && res.status === 403) {
            const body = await res.json().catch(() => null);
            if (body?.code === 'region_unavailable') {
              toast.error(
                body.error ?? "Premium isn't available in your region yet."
              );
              return;
            }
          }
          throw error;
        }

        const url = typeof data?.url === 'string' ? data.url : null;
        if (!url) throw new Error('No checkout URL returned');
        window.location.href = url;
      } catch (err) {
        console.warn('Checkout failed:', err);
        toast.error ("Couldn't open checkout — try again in a moment?");
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  return { start, busy };
};
