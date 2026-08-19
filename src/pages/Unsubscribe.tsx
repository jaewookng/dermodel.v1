import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

/**
 * One-click unsubscribe from Bella's check-in emails.
 *
 * Runs on mount rather than behind a confirm button: the link is in an email
 * the user is trying to get away from, and making them click twice is how you
 * get marked as spam instead. Re-enabling lives in Settings.
 */
export const Unsubscribe = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    let cancelled = false;
    supabase.functions
      .invoke('bella-survey', { body: { action: 'unsubscribe', token } })
      .then(({ error }) => {
        if (cancelled) return;
        setState(error ? 'error' : 'done');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-rose-50/60 to-white px-4">
      <Card className="w-full max-w-md border-rose-100 shadow-lg">
        <CardContent className="p-6 text-center">
          {state === 'working' && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {state === 'done' && (
            <>
              <h1 className="mb-2 text-lg font-semibold text-gray-900">
                You're unsubscribed
              </h1>
              <p className="mb-6 text-sm text-gray-500">
                Bella won't email you about products running low any more. You can
                turn check-ins back on in Settings whenever you like.
              </p>
              <Button onClick={() => navigate('/')} className="w-full">
                Back to dermodel
              </Button>
            </>
          )}
          {state === 'error' && (
            <>
              <h1 className="mb-2 text-lg font-semibold text-gray-900">
                That link didn't work
              </h1>
              <p className="mb-6 text-sm text-gray-500">
                It may have expired. You can turn check-ins off in Settings.
              </p>
              <Button onClick={() => navigate('/settings')} className="w-full">
                Open Settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
