import { useState } from 'react';
import { Check, Copy, Gift, Globe, Lock, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRoutineSharing, type RoutineRecommendation } from '@/hooks/useRoutineSharing';
import { ROUTINE_LABELS, type CabinetRoutine } from '@/hooks/useCabinet';

const CopyField = ({ value, label }: { value: string; label: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        className="h-9 text-sm"
        onFocus={(e) => e.target.select()}
      />
      <Button size="sm" variant="outline" onClick={copy} className="shrink-0">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  );
};

/**
 * The two loops that hang off the cabinet.
 *
 * Public routine: flips profiles.routine_public, which both publishes
 * /r/<username> and unlocks the recommendations below. The unlock is enforced
 * server-side (routine_recommendations() returns nothing while private); the
 * toggle here just reflects it.
 *
 * Invite: /?ref=<code>. The claim happens on the invitee's side after sign-in
 * and grants both people a week of Premium as a comp — never a Stripe object,
 * so nothing bills when it lapses.
 */
export const RoutineSharing = ({
  onAdd,
  adding,
  inCabinet,
}: {
  onAdd: (productId: string) => void;
  adding: boolean;
  inCabinet: Set<string>;
}) => {
  const {
    isPublic,
    setPublic,
    shareUrl,
    referralUrl,
    recommendations,
    recommendationsLoading,
    poolSize,
  } = useRoutineSharing();

  const toggle = async (next: boolean) => {
    try {
      await setPublic.mutateAsync(next);
      toast.success(next ? 'Your routine is public' : 'Your routine is private again');
    } catch (err) {
      console.error('Routine sharing update failed:', err);
      toast.error("Couldn't update that");
    }
  };

  const fresh = recommendations.filter((r) => !inCabinet.has(r.product_id));

  return (
    <div className="mb-10 space-y-6">
      {/* From routines like yours */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Users className="h-4 w-4 text-gray-400" />
          From routines like yours
        </h2>

        {!isPublic ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    See what people with your products also keep
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {poolSize > 0
                      ? `${poolSize} ${poolSize === 1 ? 'person has' : 'people have'} made their routine public. `
                      : ''}
                    Make yours public to see theirs — it's the same deal for everyone.
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={() => toggle(true)} disabled={setPublic.isPending}>
                <Globe className="mr-1.5 h-3.5 w-3.5" />
                Make my routine public
              </Button>
            </CardContent>
          </Card>
        ) : recommendationsLoading ? (
          <p className="text-sm text-gray-400">Looking through public routines…</p>
        ) : fresh.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-400">
            Nothing new yet — this fills in as more routines go public.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {fresh.map((r) => (
              <RecommendationRow key={r.product_id} r={r} onAdd={onAdd} adding={adding} />
            ))}
          </div>
        )}
      </section>

      {/* Share + invite */}
      <Card>
        <CardContent className="space-y-5 p-5">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-gray-400" />
                <p className="text-sm font-medium text-gray-800">Share your routine</p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={isPublic}
                  disabled={setPublic.isPending}
                  onChange={(e) => toggle(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-rose-400"
                />
                Public
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Shows your products and when you use them. Never sizes, dates, or your email.
            </p>
            {isPublic && shareUrl && (
              <div className="mt-3">
                <CopyField value={shareUrl} label="Your public routine link" />
              </div>
            )}
          </div>

          {referralUrl && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-rose-400" />
                <p className="text-sm font-medium text-gray-800">Invite a friend</p>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                When they sign up through your link, you both get a week of Premium free.
              </p>
              <div className="mt-3">
                <CopyField value={referralUrl} label="Your invite link" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const RecommendationRow = ({
  r,
  onAdd,
  adding,
}: {
  r: RoutineRecommendation;
  onAdd: (productId: string) => void;
  adding: boolean;
}) => (
  <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
    {r.image_url && (
      <img
        src={r.image_url}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
        className="h-10 w-10 shrink-0 rounded border bg-white object-contain p-0.5"
      />
    )}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-gray-800">{r.product_name ?? r.product_id}</p>
      <p className="text-xs text-gray-500">
        {r.shared_by} {r.shared_by === 1 ? 'routine' : 'routines'}
        {r.routine ? ` · ${ROUTINE_LABELS[r.routine as CabinetRoutine] ?? r.routine}` : ''}
        {r.overlap > 0 ? ' · shares products with yours' : ''}
      </p>
    </div>
    <Button size="sm" variant="outline" onClick={() => onAdd(r.product_id)} disabled={adding}>
      <Plus className="mr-1 h-3.5 w-3.5" /> Add
    </Button>
  </div>
);
