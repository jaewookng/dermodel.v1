import { useState, Fragment, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Heart } from 'lucide-react';
import { Product } from '@/hooks/useIngredients';
import { ProductIngredients } from './ProductIngredients';
import { ProductFavoriteButton } from './ProductFavoriteButton';
import type { GraphTarget } from '@/hooks/useGraphData';

interface ProductTableProps {
  products: Product[];
  onIngredientClick?: (ingredientId: string, ingredientName: string) => void;
  expandedId?: string | null;
  onOpenGraph?: (target: GraphTarget) => void;
}

export const ProductTable = ({ products, onIngredientClick, expandedId, onOpenGraph }: ProductTableProps) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Update expanded rows when expandedId changes from parent
  useEffect(() => {
    if (expandedId) {
      setExpandedRows(new Set([expandedId]));
    }
  }, [expandedId]);

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <div className="overflow-hidden pointer-events-auto">
      <Table className="pointer-events-auto">
        <TableHeader>
          <TableRow className="bg-gray-50 pointer-events-auto">
            <TableHead className="w-10 p-2"></TableHead>
            <TableHead className="p-2 text-xs font-medium text-gray-700">Name</TableHead>
            <TableHead className="p-2 text-xs font-medium text-gray-700">Ingredients</TableHead>
            <TableHead className="w-10 p-2"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const isExpanded = expandedRows.has(product.product_id);
            return (
              <Fragment key={product.product_id}>
                <TableRow className="hover:bg-gray-50 pointer-events-auto">
                  <TableCell className="p-2 w-10 pointer-events-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 pointer-events-auto"
                      onClick={() => toggleRow(product.product_id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="p-2 font-medium text-xs pointer-events-auto">{product.product_name}</TableCell>
                  <TableCell className="p-2 pointer-events-auto">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">
                        {product.ingredient_count || 0} ingredients
                      </span>
                      {(product.like_count || 0) > 0 && (
                        <span
                          className="flex items-center gap-0.5 text-xs text-rose-500"
                          title={`Liked by ${product.like_count} user${product.like_count === 1 ? '' : 's'}`}
                        >
                          <Heart className="h-3 w-3 fill-current" />
                          {product.like_count}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="p-2 pointer-events-auto text-right">
                    <ProductFavoriteButton productId={product.product_id} />
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow className="pointer-events-auto">
                    <TableCell colSpan={4} className="p-3 bg-gray-50 pointer-events-auto">
                      <div className="space-y-2 text-xs pointer-events-auto">
                        <ProductIngredients
                          productId={product.product_id}
                          productName={product.product_name}
                          onIngredientClick={onIngredientClick}
                          onOpenGraph={onOpenGraph}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
