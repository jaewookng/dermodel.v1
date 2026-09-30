import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type CheckoutInterval = 'monthly' | 'semiannual' | 'yearly';
export type CheckoutMode = 'subscription' | 'payment' | 'portal';

/** Reads the JSON body supabase-js hides on a non-2xx `error.context`. */
const errorBody = async (
  error: unknown
): Promise<{ status: number; body: { error?: string; code?: string } | null } | null> => {
  const res = (error as { context?: Response }).context;
  if (!res || typeof res.json !== 'function') return null;
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

/**
 * Starts Stripe Checkout, or opens the billing portal.
 *
 * The region gate is enforced server-side, so a 403 `region_unavailable` is a
 * real possible outcome even when the client believed it could sell — the
 * entitlement view can be stale. It is handled separately from a generic
 * failure because it is not something the user can retry out of, and telling
 * them to try again would be a lie (docs/payment-model.md §12.6).
 *
 * Stripe sends the user back to the page they started on, with
 * `?billing=success|topup-success|cancelled` for BillingReturnListener.
 */
export const useCheckout = () => {
  const [busy, setBusy] = useState<CheckoutMode | null>(null);

  const start = useCallback(
    async (mode: CheckoutMode = 'subscription', interval: CheckoutInterval = 'monthly') => {
      if (busy) return;
      setBusy(mode);
      let navigating = false;
      try {
        // The server only accepts same-origin return URLs and falls back to
        // /settings otherwise, so this is a preference, not a trust boundary.
        const returnUrl = window.location.origin + window.location.pathname;
        const { data, error } = await supabase.functions.invoke('create-checkout-session', {
          body:
            mode === 'subscription'
              ? { mode, plan: 'premium', interval, return_url: returnUrl }
              : { mode, return_url: returnUrl },
        });

        if (error) {
          const parsed = await errorBody(error);
          if (parsed?.status === 403 && parsed.body?.code === 'region_unavailable') {
            toast.error(parsed.body.error ?? "Premium isn't available in your region yet.");
            return;
          }
          // 400s carry a user-facing reason (e.g. top-ups not offered, no
          // subscription to manage) that isn't fixed by retrying.
          if (parsed?.status === 400 && parsed.body?.error) {
            toast.error(parsed.body.error);
            return;
          }
          throw error;
        }

        const url = typeof data?.url === 'string' ? data.url : null;
        if (!url) throw new Error('No checkout URL returned');
        // Leave `busy` set: the page is navigating away, and re-enabling the
        // button in the meantime invites a second session.
        navigating = true;
        window.location.href = url;
      } catch (err) {
        console.warn('Checkout failed:', err);
        toast.error(
          mode === 'portal'
            ? "Couldn't open billing — try again in a moment?"
            : "Couldn't open checkout — try again in a moment?"
        );
      } finally {
        if (!navigating) setBusy(null);
      }
    },
    [busy]
  );

  return { start, busy };
};
