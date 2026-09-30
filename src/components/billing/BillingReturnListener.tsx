import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useEntitlement } from '@/hooks/useEntitlement';

// Stripe redirects back before its webhook has necessarily landed, so the
// entitlement is re-read for a while rather than once.
const POLL_MS = 2000;
const MAX_POLLS = 15;

type Waiting = 'premium' | 'credit' | null;

/**
 * Handles the `?billing=` flag create-checkout-session puts on Stripe's
 * success/cancel URLs: confirms the outcome, refreshes the plan until the
 * webhook has applied it, and strips the flag so a reload doesn't repeat it.
 * Renders nothing; mounted once in App.
 */
export const BillingReturnListener = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isPremium } = useEntitlement();
  const [waiting, setWaiting] = useState<Waiting>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get('billing');
    if (!outcome) return;

    params.delete('billing');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true, state: location.state }
    );

    if (outcome === 'success') {
      toast.success('Welcome to Premium', {
        description: 'Your plan can take a few seconds to update.',
      });
      setWaiting('premium');
    } else if (outcome === 'topup-success') {
      toast.success('Bella credit added');
      setWaiting('credit');
    } else if (outcome === 'cancelled') {
      toast("Checkout cancelled — you weren't charged.");
    }
  }, [location.search, location.pathname, location.hash, location.state, navigate]);

  useEffect(() => {
    if (!waiting) return;
    // Done as soon as the webhook's effect is visible.
    if (waiting === 'premium' && isPremium) {
      setWaiting(null);
      return;
    }
    let polls = 0;
    const id = window.setInterval(() => {
      polls += 1;
      queryClient.invalidateQueries({ queryKey: ['entitlement'] });
      if (polls >= MAX_POLLS || (waiting === 'credit' && polls >= 3)) {
        window.clearInterval(id);
        setWaiting(null);
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, isPremium, queryClient]);

  return null;
};
