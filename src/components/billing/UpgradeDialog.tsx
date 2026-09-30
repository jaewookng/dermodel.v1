import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BellaOrbs } from '@/components/Bella/BellaOrbs';
import { useAuth } from '@/contexts/AuthContext';
import { useEntitlement } from '@/hooks/useEntitlement';
import { useCheckout, type CheckoutInterval } from '@/hooks/useCheckout';
import {
  useBillingPlans,
  priceCents,
  savingsPercent,
  formatUsd,
  INTERVAL_MONTHS,
  type BillingPlan,
} from '@/hooks/useBillingPlans';

const INTERVALS: { value: CheckoutInterval; label: string; per: string }[] = [
  { value: 'monthly', label: 'Monthly', per: 'per month' },
  { value: 'semiannual', label: '6 months', per: 'every 6 months' },
  { value: 'yearly', label: 'Yearly', per: 'per year' },
];

// $0.10 of credit per message (docs/payment-model.md §3). Used only to turn the
// dollar allowance into a number people can picture.
const USD_PER_MESSAGE = 0.1;

const formatDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;

/** Premium's feature list, built from the plan's flags so it can't overclaim. */
const premiumFeatures = (plan: BillingPlan): string[] => {
  const features: string[] = [];
  const credit = Number(plan.credit_allowance_usd ?? 0);
  if (credit > 0) {
    const messages = Math.round(credit / USD_PER_MESSAGE);
    features.push(`About ${messages} messages with Bella every month`);
  }
  if (plan.conversation_turn_cap == null && plan.lifetime_conversations == null) {
    features.push('No cap on conversations — start a new one whenever');
  }
  if (plan.includes_cabinet_memory) {
    features.push('Bella remembers your cabinet — what you own and what to try next');
  }
  if (plan.includes_checkin_emails) {
    features.push('A heads-up before a product you use runs out');
  }
  return features;
};

const freeSummary = (plan: BillingPlan | undefined): string | null => {
  if (!plan) return null;
  const parts: string[] = [];
  if (plan.lifetime_conversations != null) {
    const n = plan.lifetime_conversations;
    parts.push(`${n} ${n === 1 ? 'conversation' : 'conversations'} with Bella, ever`);
  } else if (plan.monthly_conversations != null) {
    parts.push(`${plan.monthly_conversations} conversations with Bella a month`);
  }
  if (plan.conversation_turn_cap != null) {
    parts.push(`up to ${plan.conversation_turn_cap} messages each`);
  }
  return parts.length ? `Free includes ${parts.join(', ')}.` : null;
};

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn: () => void;
}

/**
 * Premium plan picker. Prices and features come from `billing_plans_public`,
 * and what the button does comes from `my_chat_entitlement` — the client never
 * decides on its own whether someone can buy (docs/payment-model.md §12).
 */
export const UpgradeDialog = ({ open, onOpenChange, onSignIn }: UpgradeDialogProps) => {
  const { user, session } = useAuth();
  const signedIn = !!(user ?? session?.user);
  const { entitlement, loading: entitlementLoading, canBuy, isPremium } = useEntitlement();
  const { data: plans, isLoading: plansLoading, isError } = useBillingPlans();
  const { start, busy } = useCheckout();
  const [interval, setBillingInterval] = useState<CheckoutInterval>('yearly');

  const premium = plans?.find((p) => p.plan === 'premium');
  const free = plans?.find((p) => p.plan === 'free');
  const subscribed = isPremium && entitlement?.plan_source === 'subscription';
  const onComp = isPremium && entitlement?.plan_source === 'comp';

  const selectedCents = premium ? priceCents(premium, interval) : null;
  const selected = INTERVALS.find((i) => i.value === interval)!;
  const perMonthCents =
    selectedCents && interval !== 'monthly'
      ? Math.round(selectedCents / INTERVAL_MONTHS[interval])
      : null;
  const saving = premium ? savingsPercent(premium, interval) : 0;

  const renderAction = () => {
    if (!signedIn) {
      return (
        <Button
          className="w-full"
          onClick={() => {
            onOpenChange(false);
            onSignIn();
          }}
        >
          Sign in to continue
        </Button>
      );
    }
    if (entitlementLoading) {
      return (
        <Button className="w-full" disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking your plan…
        </Button>
      );
    }
    if (subscribed) {
      return (
        <div className="space-y-2 text-center">
          <p className="text-sm text-gray-600">You're already on Premium.</p>
          <Button
            variant="outline"
            className="w-full"
            disabled={!!busy}
            onClick={() => start('portal')}
          >
            {busy === 'portal' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Manage billing
          </Button>
        </div>
      );
    }
    // sell_premium is false here: no purchase path at all (§12.1). The server
    // would 403 anyway; a button that can only fail is worse than none.
    if (!canBuy) {
      return (
        <p className="text-center text-sm text-gray-500">
          Premium isn't available in your region yet.
        </p>
      );
    }
    return (
      <Button
        className="w-full"
        disabled={!!busy || !selectedCents}
        onClick={() => start('subscription', interval)}
      >
        {busy === 'subscription' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening checkout…
          </>
        ) : selectedCents ? (
          `Continue — ${formatUsd(selectedCents)} ${selected.per}`
        ) : (
          'Continue'
        )}
      </Button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <BellaOrbs size={28} active={false} />
            <DialogTitle>Dermodel Premium</DialogTitle>
          </div>
          <DialogDescription>
            Bella keeps track of your routine, so the advice gets more useful over time.
          </DialogDescription>
        </DialogHeader>

        {plansLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
          </div>
        ) : isError || !premium ? (
          <p className="py-8 text-center text-sm text-gray-500">
            Couldn't load plans right now. Please try again in a moment.
          </p>
        ) : (
          <div className="space-y-5">
            {!subscribed && (
              <div
                role="radiogroup"
                aria-label="Billing interval"
                className="grid grid-cols-3 gap-1 rounded-xl bg-rose-50/70 p-1"
              >
                {INTERVALS.map((opt) => {
                  const off = savingsPercent(premium, opt.value);
                  const active = opt.value === interval;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setBillingInterval(opt.value)}
                      disabled={!priceCents(premium, opt.value)}
                      className={`rounded-lg px-2 py-2 text-center transition-colors disabled:opacity-40 ${
                        active
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <span className="block text-sm font-medium">{opt.label}</span>
                      <span
                        className={`block text-[11px] ${off ? 'text-rose-500' : 'text-transparent'}`}
                      >
                        {off ? `Save ${off}%` : '—'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {!subscribed && selectedCents && (
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold tracking-tight text-gray-900">
                    {formatUsd(selectedCents)}
                  </span>
                  <span className="text-sm text-gray-500">{selected.per}</span>
                </div>
                <p className="mt-0.5 h-4 text-xs text-gray-500">
                  {perMonthCents
                    ? `${formatUsd(perMonthCents)}/month${saving ? ` · ${saving}% less than monthly` : ''}`
                    : ''}
                </p>
              </div>
            )}

            <ul className="space-y-2">
              {premiumFeatures(premium).map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {onComp && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-gray-600">
                You have free Premium until {formatDate(entitlement?.comp_until)}.
                Subscribing now keeps it going after that.
              </p>
            )}

            {renderAction()}

            <p className="text-center text-[11px] leading-relaxed text-gray-400">
              {freeSummary(free)} Your saved products stay yours on any plan.
              {!subscribed && ' Secure checkout by Stripe — cancel anytime from Settings.'}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
