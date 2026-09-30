import { useEntitlement, CHECKIN_CONSENT_TEXT } from '@/hooks/useEntitlement';
import { useCheckout } from '@/hooks/useCheckout';
import { useUpgrade } from '@/contexts/UpgradeContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CreditCard, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

/**
 * Plan, allowance and check-in email consent.
 *
 * Everything here is driven by `my_chat_entitlement` (docs/payment-model.md
 * §12.1) rather than inferred client-side, so the UI can't disagree with what
 * the server will actually enforce.
 */
export const SubscriptionStatus = () => {
  const {
    entitlement,
    loading,
    unavailable,
    isPremium,
    canBuy,
    conversationsRemaining,
    allowanceScope,
    setCheckinConsent,
  } = useEntitlement();
  const { start, busy } = useCheckout();
  const { openUpgrade } = useUpgrade();

  // The billing migrations may not be applied yet. Say nothing rather than
  // showing a wrong or alarming plan state.
  if (loading) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your plan…
        </CardContent>
      </Card>
    );
  }
  if (unavailable || !entitlement) return null;

  const renews = formatDate(entitlement.current_period_end);
  // A comp (referral week) is Premium with no Stripe object behind it: say
  // when it ends, never "renews" — nothing will bill.
  const isComp = entitlement.plan_source === 'comp';
  const compEnds = formatDate(entitlement.comp_until);
  const consentRequired = entitlement.checkin_email_consent_required === true;
  const emailsOn = entitlement.checkin_emails_effective === true;
  const consentedAt = formatDate(entitlement.checkin_email_consent_at);
  // Only a real Stripe subscription has anything to manage in the portal.
  const subscribed = isPremium && entitlement.plan_source === 'subscription';
  const pastDue = entitlement.subscription_status === 'past_due';
  const creditLeft = Number(entitlement.credit_usd_remaining_this_month ?? 0);
  const creditLow = subscribed && creditLeft < 1;

  const toggleEmails = async (next: boolean) => {
    try {
      await setCheckinConsent.mutateAsync(next);
      toast.success(next ? "You'll get check-ins from Bella" : 'Check-ins turned off');
    } catch (err) {
      console.error('Consent update failed:', err);
      toast.error("Couldn't update that");
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Plan</CardTitle>
            <CardDescription>Your subscription and Bella allowance</CardDescription>
          </div>
          <Badge variant={isPremium ? 'default' : 'secondary'}>
            {entitlement.display_name ?? (isPremium ? 'Premium' : 'Free')}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Allowance. Scope decides the wording — a lifetime allowance must
            never be described as "this month". */}
        {isPremium ? (
          <div>
            <p className="text-sm text-gray-700">
              <span className="font-medium">
                ${Number(entitlement.credit_usd_remaining_this_month ?? 0).toFixed(2)}
              </span>{' '}
              of ${Number(entitlement.credit_allowance_usd ?? 0).toFixed(2)} Bella
              credit left this month
            </p>
            {pastDue && (
              <p className="mt-1 text-xs text-amber-600">
                Your last payment didn't go through — update your card to keep Premium.
              </p>
            )}
            {isComp && compEnds ? (
              <p className="mt-1 text-xs text-gray-500">
                Free Premium until {compEnds} — nothing to cancel, it just ends.
              </p>
            ) : renews ? (
              <p className="mt-1 text-xs text-gray-500">
                {entitlement.cancel_at_period_end
                  ? `Ends ${renews}`
                  : `Renews ${renews}`}
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-700">
              <span className="font-medium">{conversationsRemaining ?? 0}</span>{' '}
              {conversationsRemaining === 1 ? 'conversation' : 'conversations'} with
              Bella left
              {allowanceScope === 'lifetime' ? '' : ' this month'}
            </p>
            {allowanceScope === 'lifetime' && (
              <p className="mt-1 text-xs text-gray-500">
                Free conversations don't reset. Your saved products stay yours either way.
              </p>
            )}
          </div>
        )}

        {/* Check-in emails. Consent goes through record_email_consent, never a
            direct column write — in consent_first regions the column alone does
            not enable sending. */}
        <div className="border-t border-gray-100 pt-4">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={emailsOn}
              disabled={setCheckinConsent.isPending}
              onChange={(e) => toggleEmails(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-rose-400"
            />
            <span className="text-sm text-gray-700">{CHECKIN_CONSENT_TEXT}</span>
          </label>
          {consentRequired && !emailsOn && (
            <p className="mt-1 pl-6 text-xs text-gray-500">
              Off by default where you are — tick the box if you'd like them.
            </p>
          )}
          {emailsOn && consentedAt && (
            <p className="mt-1 pl-6 text-xs text-gray-400">You agreed on {consentedAt}.</p>
          )}
          {!entitlement.includes_checkin_emails && (
            <p className="mt-1 pl-6 text-xs text-gray-500">
              Check-ins are a Premium feature.
            </p>
          )}
        </div>

        {/* Billing actions. The portal is never region-blocked (§12.6), so an
            existing subscriber can always manage or cancel; new purchases only
            render where we sell. */}
        {(subscribed || canBuy) && (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
            {subscribed && (
              <Button
                size="sm"
                variant={pastDue ? 'default' : 'outline'}
                disabled={!!busy}
                onClick={() => start('portal')}
              >
                {busy === 'portal' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                )}
                {pastDue ? 'Update payment method' : 'Manage billing'}
              </Button>
            )}
            {creditLow && canBuy && (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => start('payment')}
              >
                {busy === 'payment' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Add Bella credit
              </Button>
            )}
            {!subscribed && canBuy && (
              <Button size="sm" onClick={openUpgrade}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {isComp ? 'Keep Premium' : 'Upgrade to Premium'}
              </Button>
            )}
          </div>
        )}
        {subscribed && (
          <p className="text-xs text-gray-400">
            Cancel, change your card or download invoices in the billing portal.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
