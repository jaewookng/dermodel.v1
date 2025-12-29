import { useCallback, useState, useMemo, useEffect } from 'react';
import { Database, Search, Pipette } from 'lucide-react';
import { useIngredients, useIngredientsCount, useProducts, useProductsCount } from '@/hooks/useIngredients';
import { useIngredientFilters } from '@/hooks/useIngredientFilters';
import { IngredientTable } from './IngredientTable';
import { ProductTable } from './ProductTable';
import { SimplePagination } from './SimplePagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type TabView = 'ingredients' | 'products';

interface OptimizedIngredientDatabaseProps {
  initialTab?: TabView;
}

export const OptimizedIngredientDatabase = ({ initialTab = 'ingredients' }: OptimizedIngredientDatabaseProps) => {
  const [activeTab, setActiveTab] = useState<TabView>(initialTab);
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const productsPerPage = 10;

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // For cross-navigation between tabs
  const [expandedIngredientId, setExpandedIngredientId] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  const {
    filters,
    pagination,
    queryParams,
    hasActiveFilters,
    updateFilter,
    clearFilters,
    setCurrentPage,
    setItemsPerPage
  } = useIngredientFilters(300); // 300ms debounce

  // Ingredients data
  const { data: ingredientsResponse, isLoading, error, isFetching } = useIngredients(queryParams);
  const { data: totalIngredientCount = 0 } = useIngredientsCount();

  // Products data
  const { data: allProducts = [], isLoading: productsLoading, error: productsError } = useProducts();
  const { data: totalProductCount = 0 } = useProductsCount();

  const ingredients = ingredientsResponse?.data || [];
  const displayedCount = ingredientsResponse?.totalCount || 0;
  const totalPages = Math.ceil(displayedCount / pagination.itemsPerPage);

  // Filter and paginate products
  const filteredProducts = useMemo(() => {
    if (!productSearch) return allProducts;
    return allProducts.filter(p => p.product_name.toLowerCase().includes(productSearch.toLowerCase()));
  }, [allProducts, productSearch]);

  const totalProductPages = Math.ceil(filteredProducts.length / productsPerPage);
  const paginatedProducts = filteredProducts.slice(
    (productPage - 1) * productsPerPage,
    productPage * productsPerPage
  );

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, [setCurrentPage]);

  const handleItemsPerPageChange = useCallback((items: number) => {
    setItemsPerPage(items);
  }, [setItemsPerPage]);

  const handleProductPageChange = useCallback((page: number) => {
    setProductPage(page);
  }, []);

  // Navigate to a product from ingredients view
  const handleProductClick = useCallback((productId: string, productName: string) => {
    setProductSearch(productName);
    setExpandedProductId(productId);
    setProductPage(1);
    setActiveTab('products');
  }, []);

  // Navigate to an ingredient from products view
  const handleIngredientClick = useCallback((ingredientId: string, ingredientName: string) => {
    updateFilter('search', ingredientName);
    setExpandedIngredientId(ingredientId);
    setCurrentPage(1);
    setActiveTab('ingredients');
  }, [updateFilter, setCurrentPage]);

  if (error) {
    console.error('Error loading ingredients:', error);
  }

  return (
    <div className="h-full flex flex-col p-4 pointer-events-auto">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 mb-3 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('ingredients')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'ingredients'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Database className="h-4 w-4" />
          Ingredients
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'products'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Pipette className="h-4 w-4" />
          Products
        </button>
      </div>

      {/* Ingredients View */}
      {activeTab === 'ingredients' && (
        <>
          {/* Compact Header */}
          <div className="flex items-center justify-between mb-3 pointer-events-auto">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-800">Ingredient Database</h2>
              {isFetching && (
                <div className="animate-pulse w-2 h-2 bg-violet-600 rounded-full" />
              )}
            </div>
            <div className="text-xs text-gray-500">
              {totalIngredientCount.toLocaleString()} total
            </div>
          </div>
          {/* Compact Filters */}
          <div className="space-y-2 mb-3 pointer-events-auto">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Search ingredients..."
                value={filters.search}
                onChange={(e) => updateFilter('search', e.target.value)}
                className="pl-7 h-8 text-sm pointer-events-auto"
              />
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-sm pointer-events-auto">
                Clear
              </Button>
            )}
          </div>
          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto pointer-events-auto">
            {/* Loading State */}
            {isLoading && (
              <LoadingState
                message="Loading ingredients..."
                submessage="Fetching from database"
                size="sm"
              />
            )}

            {/* Error State */}
            {error && !isLoading && (
              <ErrorState
                title="Error loading ingredients"
                message="Please try refreshing the page"
                type="error"
                action={{
                  label: "Retry",
                  onClick: () => window.location.reload()
                }}
              />
            )}

            {/* Data Table */}
            {!isLoading && !error && ingredients.length > 0 && (
              <>
                <div className="bg-white rounded border overflow-hidden pointer-events-auto">
                  <IngredientTable
                    ingredients={ingredients}
                    onProductClick={handleProductClick}
                    expandedId={expandedIngredientId}
                  />
                </div>

                <div className="mt-2 pointer-events-auto">
                  <SimplePagination
                    currentPage={pagination.currentPage}
                    totalPages={totalPages}
                    itemsPerPage={pagination.itemsPerPage}
                    totalItems={displayedCount}
                    onPageChange={handlePageChange}
                    onItemsPerPageChange={handleItemsPerPageChange}
                  />
                </div>
              </>
            )}

            {/* No Results */}
            {!isLoading && !error && ingredients.length === 0 && (
              <div className="pointer-events-auto">
                <EmptyState
                  title="No ingredients found"
                  message="Try adjusting your filters or search terms"
                  icon="database"
                  action={hasActiveFilters ? {
                    label: "Clear filters",
                    onClick: clearFilters
                  } : undefined}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Products View */}
      {activeTab === 'products' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pointer-events-auto">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-800">Product Database</h2>
              {productsLoading && (
                <div className="animate-pulse w-2 h-2 bg-violet-600 rounded-full" />
              )}
            </div>
            <div className="text-xs text-gray-500">
              {totalProductCount.toLocaleString()} total
            </div>
          </div>

          {/* Search */}
          <div className="space-y-2 mb-3 pointer-events-auto">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Search products..."
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setProductPage(1);
                }}
                className="pl-7 h-8 text-sm pointer-events-auto"
              />
            </div>
            {productSearch && (
              <Button variant="ghost" size="sm" onClick={() => { setProductSearch(''); setProductPage(1); }} className="h-8 text-sm pointer-events-auto">
                Clear
              </Button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto pointer-events-auto">
            {productsLoading && (
              <LoadingState
                message="Loading products..."
                submessage="Fetching from database"
                size="sm"
              />
            )}

            {productsError && !productsLoading && (
              <ErrorState
                title="Error loading products"
                message="Please try refreshing the page"
                type="error"
                action={{
                  label: "Retry",
                  onClick: () => window.location.reload()
                }}
              />
            )}

            {!productsLoading && !productsError && paginatedProducts.length > 0 && (
              <>
                <div className="bg-white rounded border overflow-hidden pointer-events-auto">
                  <ProductTable
                    products={paginatedProducts}
                    onIngredientClick={handleIngredientClick}
                    expandedId={expandedProductId}
                  />
                </div>

                <div className="mt-2 pointer-events-auto">
                  <SimplePagination
                    currentPage={productPage}
                    totalPages={totalProductPages}
                    itemsPerPage={productsPerPage}
                    totalItems={filteredProducts.length}
                    onPageChange={handleProductPageChange}
                    onItemsPerPageChange={() => {}}
                  />
                </div>
              </>
            )}

            {!productsLoading && !productsError && paginatedProducts.length === 0 && (
              <div className="pointer-events-auto">
                <EmptyState
                  title="No products found"
                  message={productSearch ? "Try adjusting your search terms" : "No products in database"}
                  icon="database"
                  action={productSearch ? {
                    label: "Clear search",
                    onClick: () => { setProductSearch(''); setProductPage(1); }
                  } : undefined}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
