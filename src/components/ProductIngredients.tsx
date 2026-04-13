import { useQuery } from '@tanstack/react-query';
import { supabasePublic } from '@/integrations/supabase/publicClient';
import type { GraphTarget } from '@/hooks/useGraphData';
import { Network } from 'lucide-react';

interface IngredientInfo {
  ingredient_id: string;
  ingredient_name: string | null;
  position: number | null;
}

interface ProductIngredientsProps {
  productId: string;
  productName: string;
  onIngredientClick?: (ingredientId: string, ingredientName: string) => void;
  onOpenGraph?: (target: GraphTarget) => void;
}

export const useProductIngredients = (productId: string | undefined) => {
  return useQuery({
    queryKey: ['product-ingredients', productId],
    queryFn: async () => {
      if (!productId) return [];

      const { data, error } = await supabasePublic
        .from('sss_product_ingredients_join')
        .select(`
          position,
          sss_ingredients (
            ingredient_id,
            ingredient_name
          )
        `)
        .eq('product_id', productId)
        .order('position', { ascending: true });

      if (error) {
        console.error('Error fetching ingredients for product:', error);
        throw error;
      }

      return (data || []).map((item: any) => ({
        ingredient_id: item.sss_ingredients.ingredient_id,
        ingredient_name: item.sss_ingredients.ingredient_name,
        position: item.position,
      })) as IngredientInfo[];
    },
    enabled: !!productId,
  });
};

export const ProductIngredients = ({ productId, productName, onIngredientClick, onOpenGraph }: ProductIngredientsProps) => {
  const { data: ingredients, isLoading } = useProductIngredients(productId);

  if (isLoading) {
    return (
      <div className="pt-2">
        <span className="font-medium text-gray-700">Ingredients:</span>
        <div className="text-xs text-gray-400 mt-1">Loading ingredients...</div>
      </div>
    );
  }

  if (!ingredients || ingredients.length === 0) {
    return (
      <div className="pt-2">
        <span className="font-medium text-gray-700">Ingredients:</span>
        <div className="text-xs text-gray-400 mt-1">No ingredients found</div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-gray-700">Ingredients ({ingredients.length}):</span>
        {onOpenGraph && (
          <button
            onClick={() => onOpenGraph({ type: 'product', id: productId, name: productName })}
            className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-800 transition-colors font-medium"
          >
            <Network className="h-3 w-3" />
            Graph view
          </button>
        )}
      </div>
      <div className="mt-1 space-y-1">
        {ingredients.map((ingredient) => (
          <div
            key={ingredient.ingredient_id}
            className="text-xs text-gray-600 pl-2 border-l-2 border-green-200"
          >
            <div className="flex justify-between">
              <button
                onClick={() => onIngredientClick?.(ingredient.ingredient_id, ingredient.ingredient_name || '')}
                className="font-medium text-green-600 hover:text-green-800 hover:underline text-left"
              >
                {ingredient.ingredient_name}
              </button>
              {ingredient.position !== null && (
                <span className="text-gray-400 text-[10px]">
                  #{ingredient.position}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
