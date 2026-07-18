import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabasePublic } from '@/integrations/supabase/publicClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Heart } from 'lucide-react';

/**
 * Public favorites profile at /u/<user_id> — readable without signing in.
 * Backed by the public_favorites view, which only returns rows for users
 * who enabled sharing (profiles.favorites_public).
 */
const SharedFavorites = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const { data: favorites, isLoading } = useQuery({
    queryKey: ['public-favorites', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabasePublic
        .from('public_favorites')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const username = favorites?.[0]?.username || null;

  const openProduct = (id: string | null, name: string | null) => {
    if (!id || !name) return;
    navigate('/', { state: { tab: 'products' as const, openProduct: { id, name } } });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center mb-8">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="mr-4">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              {username ? `${username}'s Favorite Products` : 'Favorite Products'}
            </h1>
            <p className="text-gray-600">A shared collection on dermodel</p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-8">
              <p className="text-gray-600">Loading favorites...</p>
            </CardContent>
          </Card>
        ) : !favorites || favorites.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10">
              <Heart className="h-10 w-10 text-gray-300 mb-3" />
              <h3 className="text-base font-semibold mb-1">Nothing to see here</h3>
              <p className="text-gray-600 mb-4 text-sm">
                This favorites list is private, empty, or doesn't exist.
              </p>
              <Button onClick={() => navigate('/')}>Explore dermodel</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {favorites.map((favorite) => (
              <Card
                key={`${favorite.user_id}-${favorite.product_id}`}
                className="hover:shadow-md transition-shadow"
              >
                <CardContent className="pt-6 flex items-center gap-4">
                  {favorite.image_url && (
                    <img
                      src={favorite.image_url}
                      alt={favorite.product_name || 'Product'}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                      className="h-16 w-16 rounded border bg-white object-contain p-1 shrink-0"
                    />
                  )}
                  <div className="flex-1">
                    <button
                      onClick={() => openProduct(favorite.product_id, favorite.product_name)}
                      className="text-lg font-semibold text-left hover:text-violet-700 hover:underline"
                    >
                      {favorite.product_name || favorite.product_id}
                    </button>
                    {favorite.ingredient_count !== null && (
                      <p className="text-sm text-gray-600 mt-1">
                        {favorite.ingredient_count || 0} ingredients
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SharedFavorites;
