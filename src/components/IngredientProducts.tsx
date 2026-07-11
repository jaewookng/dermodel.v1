import { useState } from 'react';
import { useIngredientProducts } from '@/hooks/useIngredientProducts';
import type { GraphTarget } from '@/hooks/useGraphData';
import { Network, ChevronDown } from 'lucide-react';

const INITIAL_COUNT = 10;

interface IngredientProductsProps {
  ingredientId: string;
  ingredientName: string;
  onProductClick?: (productId: string, productName: string) => void;
  onOpenGraph?: (target: GraphTarget) => void;
}

export const IngredientProducts = ({ ingredientId, ingredientName, onProductClick, onOpenGraph }: IngredientProductsProps) => {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isFetching } = useIngredientProducts(
    ingredientId,
    showAll ? null : INITIAL_COUNT
  );

  if (isLoading) {
    return (
      <div className="pt-2">
        <span className="font-medium text-gray-700">Products:</span>
        <div className="text-xs text-gray-400 mt-1">Loading products...</div>
      </div>
    );
  }

  const products = data?.products ?? [];
  const totalCount = data?.totalCount ?? 0;

  if (products.length === 0) {
    return null;
  }

  const remaining = totalCount - products.length;

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-gray-700">Products ({totalCount}):</span>
        {onOpenGraph && (
          <button
            onClick={() => onOpenGraph({ type: 'ingredient', id: ingredientId, name: ingredientName })}
            className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-800 transition-colors font-medium"
          >
            <Network className="h-3 w-3" />
            Graph view
          </button>
        )}
      </div>
      <div className="mt-1 space-y-1">
        {products.map((product) => (
          <div
            key={product.product_id}
            className="text-xs text-gray-600 pl-2 border-l-2 border-blue-200"
          >
            <div className="flex justify-between">
              <button
                onClick={() => onProductClick?.(product.product_id, product.product_name)}
                className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-left"
              >
                {product.product_name}
              </button>
              {product.ingredient_count && (
                <span className="text-gray-500">
                  {product.ingredient_count} ingredients
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setShowAll(true)}
          disabled={isFetching}
          className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors disabled:opacity-50"
        >
          <ChevronDown className="h-3 w-3" />
          {isFetching ? 'Loading...' : `See all ${totalCount}`}
        </button>
      )}
    </div>
  );
};
