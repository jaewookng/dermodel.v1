import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/config';
import { useAuth } from '@/contexts/AuthContext';

const isValidUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const INSERT_TIMEOUT_MS = 15_000;

// Insert straight into PostgREST with the token we already hold, instead of
// through supabase.from(): the client's insert path first calls
// auth.getSession(), which takes the auth lock, and if anything is holding
// that lock (a stuck refresh, an awaited query inside onAuthStateChange) the
// insert never resolves and the button sits on "Submitting..." forever.
// This path has no lock and a hard timeout, so it always resolves.
const insertSubmission = async (
  row: { product_url: string; product_name: string | null; user_id: string | null },
  accessToken: string | null,
): Promise<void> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSERT_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/product_submissions`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken ?? SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: controller.signal,
    });
    if (res.ok) return;
    const body = await res.text().catch(() => '');
    // Expired/invalid user token: the submission still matters more than the
    // attribution, so retry once as an anonymous submission.
    if ((res.status === 401 || res.status === 403) && accessToken) {
      console.warn('Submission rejected with user token, retrying anonymously:', res.status, body);
      return insertSubmission({ ...row, user_id: null }, null);
    }
    throw new Error(`Insert failed (${res.status}): ${body}`);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Insert timed out after ${INSERT_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export const ProductSubmissionHelp = () => {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [productName, setProductName] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      // Reset for the next submission
      setProductName('');
      setProductUrl('');
      setSubmitted(false);
      setError(null);
    }
  };

  const handleSubmit = async () => {
    const url = productUrl.trim();
    if (!isValidUrl(url)) {
      setError('Please enter a valid link starting with http:// or https://');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const startedAt = performance.now();
      await insertSubmission(
        {
          product_url: url,
          product_name: productName.trim() || null,
          user_id: session?.user?.id ?? null,
        },
        session?.access_token ?? null,
      );
      console.info(`Product submission stored in ${Math.round(performance.now() - startedAt)}ms`);

      // Best-effort admin email; the submission row above is the source of
      // truth, so a notification failure shouldn't fail the submission.
      supabase.functions
        .invoke('notify-product-submission', {
          body: { product_url: url, product_name: productName.trim() || null },
        })
        .then(({ error }) => {
          if (error) console.warn('Submission email not sent:', error);
        })
        .catch((err) => console.warn('Submission email not sent:', err));

      setSubmitted(true);
    } catch (err) {
      console.error('Product submission failed:', err);
      setError(
        err instanceof Error && err.message.includes('timed out')
          ? 'The submission timed out. Check your connection and try again.'
          : 'Something went wrong submitting your product. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Submit a product"
            onClick={() => setOpen(true)}
            className="text-gray-400 hover:text-violet-600 transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs px-3 py-2">
          <p>Don't see your product?</p>
          <p>
            Submit it{' '}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-violet-300 underline underline-offset-2 hover:text-violet-200 font-medium"
            >
              here
            </button>
          </p>
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {submitted ? (
            <DialogHeader>
              <DialogTitle>Thank you for your submission!</DialogTitle>
              <DialogDescription className="pt-2">
                A team member will verify this product and add it to our database
                shortly. We value your contribution to our community :)
              </DialogDescription>
            </DialogHeader>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Submit a product</DialogTitle>
                <DialogDescription>
                  Share a link to a product you'd like to see in our database.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="submission-name" className="text-xs">
                    Product name <span className="text-gray-400">(optional)</span>
                  </Label>
                  <Input
                    id="submission-name"
                    placeholder="e.g. CeraVe Hydrating Cleanser"
                    value={productName}
                    maxLength={200}
                    onChange={(e) => setProductName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="submission-url" className="text-xs">
                    Link to the product
                  </Label>
                  <Input
                    id="submission-url"
                    type="url"
                    placeholder="https://..."
                    value={productUrl}
                    maxLength={2048}
                    onChange={(e) => setProductUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmit();
                    }}
                    className="h-9 text-sm"
                  />
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
              </div>
              <DialogFooter>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !productUrl.trim()}
                  size="sm"
                >
                  {submitting ? 'Submitting...' : 'Submit product'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
