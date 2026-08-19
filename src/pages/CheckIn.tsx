import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface CheckInInfo {
  product_name: string | null;
  opened_on: string | null;
  already_answered: boolean;
}

const Stars = ({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (v: number) => void;
  label: string;
}) => (
  <div>
    <p className="mb-2 text-sm font-medium text-gray-700">{label}</p>
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} out of 5`}
          aria-pressed={value === n}
          className={`h-10 w-10 rounded-full border text-sm font-semibold transition-colors ${
            value !== null && n <= value
              ? 'border-rose-300 bg-rose-100 text-rose-700'
              : 'border-gray-200 bg-white text-gray-400 hover:border-rose-200'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  </div>
);

/**
 * The survey behind Bella's check-in email. Reached from an emailed link with
 * no session, so everything is authorised by the token in the URL — the page
 * never sends a user id and never needs the visitor to log in.
 */
export const CheckIn = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [info, setInfo] = useState<CheckInInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skinRating, setSkinRating] = useState<number | null>(null);
  const [productRating, setProductRating] = useState<number | null>(null);
  const [repurchase, setRepurchase] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const call = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const { data, error } = await supabase.functions.invoke('bella-survey', {
        body: { action, token, ...extra },
      });
      if (error) throw error;
      return data;
    },
    [token]
  );

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its code.');
      return;
    }
    let cancelled = false;
    call('load')
      .then((data) => {
        if (cancelled) return;
        setInfo(data as CheckInInfo);
      })
      .catch(() => {
        if (!cancelled) setLoadError("This link isn't valid any more.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, call]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await call('submit', {
        skin_rating: skinRating,
        product_rating: productRating,
        would_repurchase: repurchase,
        notes: notes.trim() || null,
      });
      setDone(true);
    } catch (err) {
      console.warn('Survey submit failed:', err);
      setLoadError("Couldn't save that — try again in a moment?");
    } finally {
      setSubmitting(false);
    }
  };

  const product = info?.product_name ?? 'your product';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-rose-50/60 to-white px-4 py-10">
      <Card className="w-full max-w-md border-rose-100 shadow-lg">
        <CardContent className="p-6">
          {loadError ? (
            <>
              <h1 className="mb-2 text-lg font-semibold text-gray-900">
                Something's off
              </h1>
              <p className="mb-5 text-sm text-gray-500">{loadError}</p>
              <Button onClick={() => navigate('/')} className="w-full">
                Go to dermodel
              </Button>
            </>
          ) : !info ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : done ? (
            <>
              <h1 className="mb-2 text-lg font-semibold text-gray-900">
                Thank you — that helps a lot.
              </h1>
              <p className="mb-5 text-sm text-gray-500">
                I'll use this to make what I suggest next actually fit your skin.
              </p>
              <Button onClick={() => navigate('/')} className="w-full">
                Back to dermodel
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-gray-900">
                How did it go?
              </h1>
              <p className="mb-6 mt-1 text-sm text-gray-500">
                About your <span className="font-medium text-gray-700">{product}</span>.
                Every question is optional.
              </p>

              {info.already_answered && (
                <p className="mb-5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  You've answered this one already — submitting again will update
                  your answers.
                </p>
              )}

              <div className="space-y-5">
                <Stars
                  label="How's your skin doing lately?"
                  value={skinRating}
                  onChange={setSkinRating}
                />
                <Stars
                  label={`How did you like it?`}
                  value={productRating}
                  onChange={setProductRating}
                />

                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">
                    Would you buy it again?
                  </p>
                  <div className="flex gap-2">
                    {[
                      { label: 'Yes', value: true },
                      { label: 'No', value: false },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() =>
                          setRepurchase((cur) => (cur === opt.value ? null : opt.value))
                        }
                        className={`flex-1 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                          repurchase === opt.value
                            ? 'border-rose-300 bg-rose-100 text-rose-700'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-rose-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">
                    Anything else? (optional)
                  </p>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="Broke me out, loved the texture, too heavy for summer…"
                  />
                </div>
              </div>

              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="mt-6 w-full"
              >
                {submitting ? 'Saving…' : 'Send'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
