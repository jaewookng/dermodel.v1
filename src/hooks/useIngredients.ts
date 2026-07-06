import { useQuery } from '@tanstack/react-query';
import { supabasePublic } from '@/integrations/supabase/publicClient';
import { ProcessedIngredient } from '@/lib/ingredientProcessor';

interface FilterParams {
  search?: string;
  hasData?: string;
  sortBy?: string;
  page?: number;
  limit?: number;
}

interface IngredientsResponse {
  data: ProcessedIngredient[];
  totalCount: number;
  hasMore: boolean;
}

export interface Product {
  product_id: string;
  product_name: string;
  ingredient_count: number | null;
  // Popularity: total times this product was liked across all users (global)
  like_count?: number;
}

export const useIngredients = (filters: FilterParams = {}) => {
  const { page = 1, limit = 50, search, hasData, sortBy = 'popularity' } = filters;

  return useQuery({
    queryKey: ['ingredients', { page, limit, search, hasData, sortBy }],
    queryFn: async (): Promise<IngredientsResponse> => {
      // Read from the ranked view so popularity (like_count = times the
      // ingredient is cited in users' liked products, globally) is sortable
      // server-side alongside pagination and search.
      let query = supabasePublic
        .from('sss_ingredients_ranked')
        .select('*', { count: 'exact' })
        .not('ingredient_name', 'is', null);

      if (search?.trim())
        query = query.ilike('ingredient_name', `%${search.trim()}%`);

      if (hasData === 'with-products')
        query = query.gt('product_count', 0);

      if (sortBy === 'name')
        query = query.order('ingredient_name', { ascending: true });
      else if (sortBy === 'name-desc')
        query = query.order('ingredient_name', { ascending: false });
      else if (sortBy === 'product-count')
        query = query.order('product_count', { ascending: false });
      else
        // popularity (default): most-liked first, then by product count as a
        // tiebreaker so ingredients with no likes still order sensibly.
        query = query
          .order('like_count', { ascending: false })
          .order('product_count', { ascending: false });

      const from = (page - 1) * limit;
      const { data, count, error } = await query.range(from, from + limit - 1);

      if (error) throw error;

      const processed: ProcessedIngredient[] = (data || []).map(row => ({
        id: row.ingredient_id!,
        name: row.ingredient_name!,
        description: '',
        benefits: [],
        skinTypes: [],
        concerns: [],
        sources: [],
        functions: [],
        productCount: row.product_count || 0,
        avgPosition: row.avg_position || null,
        likeCount: row.like_count || 0,
      }));

      return {
        data: processed,
        totalCount: count || 0,
        hasMore: from + limit < (count || 0),
      };
    },
    enabled: true,
    retry: 2,
    retryDelay: 500,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
};

// Hook for getting total count of ingredients
export const useIngredientsCount = () => {
  return useQuery({
    queryKey: ['ingredients-count'],
    queryFn: async () => {
      const { count, error } = await supabasePublic
        .from('sss_ingredients')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;

      return count || 0;
    },
    enabled: true,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
};

// Hook for fetching all products
export const useProducts = () => {
  return useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      let allProducts: Product[] = [];
      let from = 0;
      const batchSize = 1000; // Supabase default limit

      while (true) {
        // Read from the ranked view so products default to popularity order
        // (like_count = total likes across all users), then name as tiebreaker.
        const { data, error } = await supabasePublic
          .from('sss_products_ranked')
          .select('*')
          .order('like_count', { ascending: false })
          .order('product_name', { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) {
          console.error('❌ Supabase error fetching products:', error);
          throw error;
        }

        if (data && data.length > 0) {
          const mapped: Product[] = data
            .filter(row => row.product_id && row.product_name)
            .map(row => ({
              product_id: row.product_id!,
              product_name: row.product_name!,
              ingredient_count: row.ingredient_count,
              like_count: row.like_count || 0,
            }));
          allProducts = [...allProducts, ...mapped];
          from += batchSize;

          // Stop if we got less than a full batch (no more data)
          if (data.length < batchSize) {
            break;
          }
        } else {
          break;
        }
      }

      return allProducts;
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
};

// Hook for getting total count of products
export const useProductsCount = () => {
  return useQuery({
    queryKey: ['products-count'],
    queryFn: async () => {
      const { count, error } = await supabasePublic
        .from('sss_products')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;

      return count || 0;
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
};
