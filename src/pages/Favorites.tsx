import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useProductFavorites } from '@/hooks/useProductFavorites'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Heart, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export const Favorites = () => {
  const { session } = useAuth()
  const navigate = useNavigate()
  const {
    favorites: productFavorites,
    loading: productsLoading,
    removeFavorite: removeProductFavorite,
  } = useProductFavorites()

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold mb-4">Not Signed In</h1>
        <Button onClick={() => navigate('/')}>Back to Home</Button>
      </div>
    )
  }

  const handleRemoveProductFavorite = async (productId: string) => {
    try {
      await removeProductFavorite.mutateAsync(productId)
      toast.success('Removed from favorites')
    } catch (error) {
      console.error('Failed to remove product favorite:', error)
      toast.error('Failed to remove favorite')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="mr-4"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Favorites</h1>
            <p className="text-gray-600">Your curated collection of skincare items</p>
          </div>
        </div>

        {/* Favorite Products */}
        <div className="mb-10">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xl font-semibold">Favorite Products</h2>
            <p className="text-sm text-gray-500">{productFavorites.length} saved</p>
          </div>

          {productsLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <p className="text-gray-600">Loading favorite products...</p>
              </CardContent>
            </Card>
          ) : productFavorites.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-10">
                <Heart className="h-10 w-10 text-gray-300 mb-3" />
                <h3 className="text-base font-semibold mb-1">No favorite products yet</h3>
                <p className="text-gray-600 mb-4 text-sm">Like products from the Products tab</p>
                <Button onClick={() => navigate('/', { state: { tab: 'products' as const } })}>Explore</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {productFavorites.map((favorite) => (
                <Card key={favorite.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6 flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold">
                        {favorite.sss_products?.product_name || favorite.product_id}
                      </h3>
                      {favorite.sss_products?.ingredient_count !== undefined && (
                        <p className="text-sm text-gray-600 mt-1">
                          {favorite.sss_products?.ingredient_count || 0} ingredients
                        </p>
                      )}
                      {favorite.notes && (
                        <p className="text-sm text-gray-600 mt-1">{favorite.notes}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">
                          Added {new Date(favorite.created_at).toLocaleDateString()}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveProductFavorite(favorite.product_id)}
                      disabled={removeProductFavorite.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
