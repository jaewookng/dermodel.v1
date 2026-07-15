import { useState } from 'react';
import { Heart } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoginDialog } from '@/components/Auth/LoginDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useProductFavorites } from '@/hooks/useProductFavorites';

interface ProductFavoriteButtonProps {
  productId: string;
  /** Global like count shown next to the heart; hidden when 0 */
  likeCount?: number;
  className?: string;
}

export const ProductFavoriteButton = ({ productId, likeCount = 0, className }: ProductFavoriteButtonProps) => {
  const { session } = useAuth();
  const { isFavorite, addFavorite, removeFavorite } = useProductFavorites();
  const [loginOpen, setLoginOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const favorite = isFavorite(productId);

  const handleFavoriteClick = async () => {
    if (!session) {
      setLoginOpen(true);
      return;
    }

    try {
      setIsLoading(true);
      if (favorite) {
        await removeFavorite.mutateAsync(productId);
        toast.success('Removed from favorites');
      } else {
        await addFavorite.mutateAsync(productId);
        toast.success('Added to favorites');
      }
    } catch (error) {
      console.error('Failed to toggle product favorite:', error);
      toast.error('Failed to update favorite');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleFavoriteClick}
        disabled={isLoading || addFavorite.isPending || removeFavorite.isPending}
        className={className}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Heart className={`h-4 w-4 ${favorite ? 'fill-red-500 text-red-500' : 'text-gray-400'}`} />
        {likeCount > 0 && (
          <span className="ml-1 text-xs text-gray-500">{likeCount}</span>
        )}
      </Button>
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </>
  );
};

