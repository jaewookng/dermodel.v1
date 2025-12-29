import { useState, Fragment, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ProcessedIngredient } from '@/lib/ingredientProcessor';
import { IngredientProducts } from './IngredientProducts';

interface IngredientTableProps {
  ingredients: ProcessedIngredient[];
  onProductClick?: (productId: string, productName: string) => void;
  expandedId?: string | null;
}

export const IngredientTable = ({ ingredients, onProductClick, expandedId }: IngredientTableProps) => {
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
            <TableHead className="p-2 text-xs font-medium text-gray-700">Found in..</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ingredients.map((ingredient) => {
            const isExpanded = expandedRows.has(ingredient.id);
            return (
              <Fragment key={ingredient.id}>
                <TableRow className="hover:bg-gray-50 pointer-events-auto">
                  <TableCell className="p-2 w-10 pointer-events-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 pointer-events-auto"
                      onClick={() => toggleRow(ingredient.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="p-2 font-medium text-xs pointer-events-auto">{ingredient.name}</TableCell>
                  <TableCell className="p-2 pointer-events-auto">
                    <span className="text-xs text-gray-600">
                      {ingredient.productCount || 0} products
                    </span>
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow className="pointer-events-auto">
                    <TableCell colSpan={3} className="p-3 bg-gray-50 pointer-events-auto">
                      <div className="space-y-2 text-xs pointer-events-auto">
                        <IngredientProducts ingredientId={ingredient.id} onProductClick={onProductClick} />
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
