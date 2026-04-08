import { useQuery } from '@tanstack/react-query';
import { supabasePublic } from '@/integrations/supabase/publicClient';

export interface ProductInfo {
  product_id: string;
  product_name: string;
  ingredient_count: number | null;
  position: number | null;
}

export const useIngredientProducts = (ingredientId: string | undefined) => {
  return useQuery({
    queryKey: ['ingredient-products', ingredientId],
    queryFn: async () => {
      if (!ingredientId) return [];

      // Fetch products for this ingredient by joining the junction table
      const { data, error } = await supabasePublic
        .from('sss_product_ingredients_join')
        .select(`
          position,
          sss_products (
            product_id,
            product_name,
            ingredient_count
          )
        `)
        .eq('ingredient_id', ingredientId)
        .order('position', { ascending: true });

      if (error) {
        console.error('Error fetching products:', error);
        throw error;
      }

      // Transform the nested data structure into a flat array
      return (data || []).map((item: any) => ({
        product_id: item.sss_products.product_id,
        product_name: item.sss_products.product_name,
        ingredient_count: item.sss_products.ingredient_count,
        position: item.position,
      })) as ProductInfo[];
    },
    enabled: !!ingredientId,
  });
};
