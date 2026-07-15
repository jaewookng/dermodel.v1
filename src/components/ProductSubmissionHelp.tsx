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
import { useAuth } from '@/contexts/AuthContext';

const isValidUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
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
      const { error: insertError } = await supabase.from('product_submissions').insert({
        product_url: url,
        product_name: productName.trim() || null,
        user_id: session?.user?.id ?? null,
      });
      if (insertError) throw insertError;

      // Best-effort admin email; the submission row above is the source of
      // truth, so a notification failure shouldn't fail the submission.
      supabase.functions
        .invoke('notify-product-submission', {
          body: { product_url: url, product_name: productName.trim() || null },
        })
        .catch(() => {});

      setSubmitted(true);
    } catch (err) {
      console.error('Product submission failed:', err);
      setError('Something went wrong submitting your product. Please try again.');
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
            aria-label="How to submit a product"
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
