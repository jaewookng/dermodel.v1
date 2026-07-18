import { useState } from 'react';
import { Share, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Share icon (top right of the Favorites page). Opens a dialog that flips
 * profiles.favorites_public on, shows the public link (/u/<user_id>), and
 * lets the user copy it or make the list private again.
 */
export const ShareFavoritesButton = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [isPublic, setIsPublic] = useState<boolean>(user?.favorites_public ?? false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  const shareUrl = `${window.location.origin}/u/${user.id}`;

  const setPublic = async (value: boolean) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ favorites_public: value })
        .eq('id', user.id);
      if (error) throw error;
      setIsPublic(value);
      if (!value) toast.success('Your favorites are private again');
      return true;
    } catch (error) {
      console.error('Failed to update sharing:', error);
      toast.error('Failed to update sharing settings');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    setCopied(false);
    // Sharing implies making the list public — flip it on when opening
    if (!isPublic) await setPublic(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        title="Share your favorites"
        aria-label="Share your favorites"
      >
        <Share className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share your favorites</DialogTitle>
            <DialogDescription>
              {isPublic
                ? `Anyone with this link can view ${user.username || 'your'}'s favorite products.`
                : 'Enabling sharing makes your favorites list publicly viewable.'}
            </DialogDescription>
          </DialogHeader>

          {isPublic && (
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} className="h-9 text-sm" onFocus={(e) => e.target.select()} />
              <Button size="sm" onClick={handleCopy} className="shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          )}

          <div className="flex justify-end">
            {isPublic ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={async () => {
                  if (await setPublic(false)) setOpen(false);
                }}
                className="text-gray-500"
              >
                Stop sharing
              </Button>
            ) : (
              <Button size="sm" disabled={saving} onClick={() => setPublic(true)}>
                {saving ? 'Enabling…' : 'Enable sharing'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
