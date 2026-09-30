import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { CheckoutInterval } from '@/hooks/useCheckout';

export type BillingPlan = Database['public']['Views']['billing_plans_public']['Row'];

/** Months covered by one charge at each interval. */
export const INTERVAL_MONTHS: Record<CheckoutInterval, number> = {
  monthly: 1,
  semiannual: 6,
  yearly: 12,
};

/** Price in cents for one charge at `interval`, or null if the plan has none. */
export const priceCents = (plan: BillingPlan, interval: CheckoutInterval): number | null => {
  const cents =
    interval === 'monthly'
      ? plan.price_cents_monthly
      : interval === 'semiannual'
        ? plan.price_cents_semiannual
        : plan.price_cents_yearly;
  return cents && cents > 0 ? cents : null;
};

/** Whole-percent saving of `interval` against paying monthly for the same span. */
export const savingsPercent = (plan: BillingPlan, interval: CheckoutInterval): number => {
  const monthly = priceCents(plan, 'monthly');
  const price = priceCents(plan, interval);
  if (!monthly || !price) return 0;
  const saving = 1 - price / (monthly * INTERVAL_MONTHS[interval]);
  return saving > 0.005 ? Math.round(saving * 100) : 0;
};

export const formatUsd = (cents: number) =>
  `$${(cents / 100).toFixed(2)}`;

/**
 * The public plan catalog (docs/payment-model.md §12.2). Readable signed out,
 * so the pricing dialog works before sign-in. Prices live in the database, so
 * nothing here hardcodes an amount.
 */
export const useBillingPlans = () =>
  useQuery({
    queryKey: ['billing-plans'],
    queryFn: async (): Promise<BillingPlan[]> => {
      const { data, error } = await supabase
        .from('billing_plans_public')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30 * 60 * 1000,
  });
