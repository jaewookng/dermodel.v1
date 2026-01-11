import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
}

export const useIngredients = (filters: FilterParams = {}) => {
  const { page = 1, limit = 50, search, hasData, sortBy = 'name' } = filters;

  return useQuery({
    queryKey: ['ingredients', { page, limit, search, hasData, sortBy }],
    queryFn: async (): Promise<IngredientsResponse> => {
      console.log('🔍 Fetching ingredients from sss_ingredients table with filters:', filters);

      try {
        // Fetch ALL ingredients - Supabase limits to 1000 per request, so we batch
        let allIngredients: any[] = [];
        let from = 0;
        const batchSize = 1000; // Supabase default limit

        while (true) {
          console.log(`📦 Fetching ingredients batch: range(${from}, ${from + batchSize - 1})`);

          const { data, error } = await supabase
            .from('sss_ingredients')
            .select('*')
            .order('ingredient_name', { ascending: true })
            .range(from, from + batchSize - 1);

          if (error) {
            console.error('❌ Supabase error:', error);
            throw error;
          }

          const batchLength = data?.length || 0;
          console.log(`📦 Batch returned ${batchLength} ingredients`);

          if (data && data.length > 0) {
            allIngredients = [...allIngredients, ...data];
            from += batchSize;

            // Stop if we got less than a full batch (no more data)
            if (data.length < batchSize) {
              break;
            }
          } else {
            break;
          }
        }

        console.log('✅ Fetched all ingredients from sss_ingredients:', allIngredients.length);

        // Transform database results to ProcessedIngredient format
        let processed: ProcessedIngredient[] = allIngredients
          .filter(row => row.ingredient_name) // Filter out null names
          .map(row => ({
            id: row.ingredient_id,
            name: row.ingredient_name!,
            description: '',
            benefits: [],
            skinTypes: [],
            concerns: [],
            sources: [],
            functions: [],
            productCount: row.product_count || 0,
            avgPosition: row.avg_position || null,
          }));

        console.log('🔄 Processed ingredients:', processed.length);

        // Apply search filter
        if (search && search.trim()) {
          const searchTerm = search.trim().toLowerCase();
          processed = processed.filter(ingredient =>
            ingredient.name.toLowerCase().includes(searchTerm)
          );
        }

        // Apply data availability filters
        if (hasData === 'with-products') {
          processed = processed.filter(ing => ing.productCount && ing.productCount > 0);
        }

        // Sorting
        if (sortBy === 'name-desc') {
          processed = processed.sort((a, b) => b.name.localeCompare(a.name));
        } else if (sortBy === 'product-count') {
          processed = processed.sort((a, b) => (b.productCount || 0) - (a.productCount || 0));
        }
        // sortBy === 'name' is already applied by database ORDER BY

        const totalCount = processed.length;

        // Apply pagination
        const fromIdx = (page - 1) * limit;
        const toIdx = fromIdx + limit;
        const paginatedData = processed.slice(fromIdx, toIdx);

        console.log('📄 Paginated ingredients:', paginatedData.length, 'items, total:', totalCount);

        return {
          data: paginatedData,
          totalCount,
          hasMore: toIdx < totalCount
        };
      } catch (error) {
        console.error('💥 Error in ingredient fetch:', error);
        throw error;
      }
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
      const { count, error } = await supabase
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
      console.log('🔍 Fetching all products from sss_products');

      let allProducts: Product[] = [];
      let from = 0;
      const batchSize = 1000; // Supabase default limit

      while (true) {
        console.log(`📦 Fetching products batch: range(${from}, ${from + batchSize - 1})`);

        const { data, error } = await supabase
          .from('sss_products')
          .select('*')
          .order('product_name', { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) {
          console.error('❌ Supabase error fetching products:', error);
          throw error;
        }

        const batchLength = data?.length || 0;
        console.log(`📦 Batch returned ${batchLength} products`);

        if (data && data.length > 0) {
          allProducts = [...allProducts, ...data];
          from += batchSize;

          // Stop if we got less than a full batch (no more data)
          if (data.length < batchSize) {
            break;
          }
        } else {
          break;
        }
      }

      console.log('✅ Fetched all products:', allProducts.length);
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
      const { count, error } = await supabase
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
