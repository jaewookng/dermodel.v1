import { useState, useCallback, useMemo } from 'react';
import { useDebounce } from './useDebounce';

export interface FilterState {
  search: string;
  hasData: string;
  sortBy: string;
}

export interface PaginationState {
  currentPage: number;
  itemsPerPage: number;
}

const DEFAULT_FILTERS: FilterState = {
  search: '',
  hasData: 'all',
  sortBy: 'popularity'
};

const DEFAULT_PAGINATION: PaginationState = {
  currentPage: 1,
  itemsPerPage: 10
};

export const useIngredientFilters = (debounceDelay: number = 300) => {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);
  
  // Debounce search for performance
  const debouncedSearch = useDebounce(filters.search, debounceDelay);
  
  // Update a single filter
  const updateFilter = useCallback((key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, currentPage: 1 })); // Reset to page 1
  }, []);
  
  // Clear all filters
  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPagination(prev => ({ ...prev, currentPage: 1 }));
  }, []);
  
  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return filters.search !== '' ||
           filters.hasData !== 'all';
  }, [filters]);

  // Update pagination
  const setCurrentPage = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, currentPage: page }));
  }, []);

  const setItemsPerPage = useCallback((items: number) => {
    setPagination({ currentPage: 1, itemsPerPage: items });
  }, []);

  // Build query parameters for API calls
  const queryParams = useMemo(() => ({
    search: debouncedSearch,
    hasData: filters.hasData,
    sortBy: filters.sortBy,
    page: pagination.currentPage,
    limit: pagination.itemsPerPage
  }), [debouncedSearch, filters.hasData, filters.sortBy, pagination]);
  
  return {
    filters,
    pagination,
    debouncedSearch,
    queryParams,
    hasActiveFilters,
    updateFilter,
    clearFilters,
    setCurrentPage,
    setItemsPerPage
  };
};