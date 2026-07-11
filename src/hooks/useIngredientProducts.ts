import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabasePublic } from '@/integrations/supabase/publicClient';

export interface ProductInfo {
  product_id: string;
  product_name: string;
  ingredient_count: number | null;
  position: number | null;
}

export interface IngredientProductsPage {
  products: ProductInfo[];
  totalCount: number;
}

// limit = null fetches every product (used by "See all")
export const useIngredientProducts = (ingredientId: string | undefined, limit: number | null) => {
  return useQuery({
    queryKey: ['ingredient-products', ingredientId, limit],
    queryFn: async (): Promise<IngredientProductsPage> => {
      if (!ingredientId) return { products: [], totalCount: 0 };

      // Fetch products for this ingredient by joining the junction table,
      // capped at `limit` rows; count gives the total for the "See all" UI.
      let query = supabasePublic
        .from('sss_product_ingredients_join')
        .select(
          `
          position,
          sss_products (
            product_id,
            product_name,
            ingredient_count
          )
        `,
          { count: 'exact' }
        )
        .eq('ingredient_id', ingredientId)
        .order('position', { ascending: true });

      if (limit !== null) {
        query = query.range(0, limit - 1);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('Error fetching products:', error);
        throw error;
      }

      // Transform the nested data structure into a flat array
      const products = (data || []).map((item: any) => ({
        product_id: item.sss_products.product_id,
        product_name: item.sss_products.product_name,
        ingredient_count: item.sss_products.ingredient_count,
        position: item.position,
      })) as ProductInfo[];

      return { products, totalCount: count ?? products.length };
    },
    enabled: !!ingredientId,
    // Keep the current list on screen while the next "See more" batch loads
    placeholderData: keepPreviousData,
  });
};
