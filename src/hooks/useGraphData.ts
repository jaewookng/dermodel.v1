import { useQuery } from '@tanstack/react-query';
import { supabasePublic } from '@/integrations/supabase/publicClient';

export interface GraphNode {
  id: string;
  name: string;
  type: 'focal' | 'ingredient' | 'product';
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphTarget {
  type: 'ingredient' | 'product';
  id: string;
  name: string;
}

// Ingredient graph: ingredient → products (hop 1) → co-ingredients (hop 2)
const fetchIngredientGraph = async (
  ingredientId: string,
  ingredientName: string,
): Promise<GraphData> => {
  // Hop 1: products containing this ingredient (cap at 30)
  const { data: hop1, error: e1 } = await supabasePublic
    .from('sss_product_ingredients_join')
    .select('product_id, sss_products(product_id, product_name)')
    .eq('ingredient_id', ingredientId)
    .limit(30);

  if (e1) throw e1;

  const products = (hop1 || []).map((r: any) => ({
    product_id: r.sss_products.product_id as string,
    product_name: r.sss_products.product_name as string,
  }));

  const productIds = products.map((p) => p.product_id);

  // Hop 2: all other ingredients in those products
  const { data: hop2, error: e2 } =
    productIds.length > 0
      ? await supabasePublic
          .from('sss_product_ingredients_join')
          .select('product_id, ingredient_id, sss_ingredients(ingredient_id, ingredient_name)')
          .in('product_id', productIds)
          .neq('ingredient_id', ingredientId)
          .limit(500)
      : { data: [], error: null };

  if (e2) throw e2;

  // Build nodes (deduplicated)
  const nodeMap = new Map<string, GraphNode>();
  nodeMap.set(`i:${ingredientId}`, {
    id: `i:${ingredientId}`,
    name: ingredientName,
    type: 'focal',
  });

  for (const p of products) {
    nodeMap.set(`p:${p.product_id}`, {
      id: `p:${p.product_id}`,
      name: p.product_name,
      type: 'product',
    });
  }

  for (const r of (hop2 || []) as any[]) {
    const coId = r.sss_ingredients.ingredient_id;
    const coName = r.sss_ingredients.ingredient_name;
    if (!nodeMap.has(`i:${coId}`)) {
      nodeMap.set(`i:${coId}`, { id: `i:${coId}`, name: coName, type: 'ingredient' });
    }
  }

  // Build links
  const links: GraphLink[] = [];

  for (const p of products) {
    links.push({ source: `i:${ingredientId}`, target: `p:${p.product_id}` });
  }

  const addedLinks = new Set<string>();
  for (const r of (hop2 || []) as any[]) {
    const coId = r.sss_ingredients.ingredient_id;
    const key = `${r.product_id}→i:${coId}`;
    if (!addedLinks.has(key)) {
      addedLinks.add(key);
      links.push({ source: `p:${r.product_id}`, target: `i:${coId}` });
    }
  }

  return { nodes: Array.from(nodeMap.values()), links };
};

// Product graph: product → ingredients (hop 1) → co-products (hop 2)
const fetchProductGraph = async (
  productId: string,
  productName: string,
): Promise<GraphData> => {
  // Hop 1: ingredients in this product
  const { data: hop1, error: e1 } = await supabasePublic
    .from('sss_product_ingredients_join')
    .select('ingredient_id, sss_ingredients(ingredient_id, ingredient_name)')
    .eq('product_id', productId)
    .order('position', { ascending: true });

  if (e1) throw e1;

  const ingredients = (hop1 || []).map((r: any) => ({
    ingredient_id: r.sss_ingredients.ingredient_id as string,
    ingredient_name: r.sss_ingredients.ingredient_name as string,
  }));

  const ingredientIds = ingredients.map((i) => i.ingredient_id);

  // Hop 2: other products containing those ingredients (capped)
  const { data: hop2, error: e2 } =
    ingredientIds.length > 0
      ? await supabasePublic
          .from('sss_product_ingredients_join')
          .select('ingredient_id, product_id, sss_products(product_id, product_name)')
          .in('ingredient_id', ingredientIds)
          .neq('product_id', productId)
          .limit(200)
      : { data: [], error: null };

  if (e2) throw e2;

  // Build nodes
  const nodeMap = new Map<string, GraphNode>();
  nodeMap.set(`p:${productId}`, {
    id: `p:${productId}`,
    name: productName,
    type: 'focal',
  });

  for (const i of ingredients) {
    nodeMap.set(`i:${i.ingredient_id}`, {
      id: `i:${i.ingredient_id}`,
      name: i.ingredient_name,
      type: 'ingredient',
    });
  }

  for (const r of (hop2 || []) as any[]) {
    const coId = r.sss_products.product_id;
    const coName = r.sss_products.product_name;
    if (!nodeMap.has(`p:${coId}`)) {
      nodeMap.set(`p:${coId}`, { id: `p:${coId}`, name: coName, type: 'product' });
    }
  }

  // Build links
  const links: GraphLink[] = [];

  for (const i of ingredients) {
    links.push({ source: `p:${productId}`, target: `i:${i.ingredient_id}` });
  }

  const addedLinks = new Set<string>();
  for (const r of (hop2 || []) as any[]) {
    const coId = r.sss_products.product_id;
    const key = `i:${r.ingredient_id}→${coId}`;
    if (!addedLinks.has(key)) {
      addedLinks.add(key);
      links.push({ source: `i:${r.ingredient_id}`, target: `p:${coId}` });
    }
  }

  return { nodes: Array.from(nodeMap.values()), links };
};

export const useGraphData = (target: GraphTarget | null) => {
  return useQuery({
    queryKey: ['graph-data', target?.type, target?.id],
    queryFn: () => {
      if (!target) return { nodes: [], links: [] };
      if (target.type === 'ingredient')
        return fetchIngredientGraph(target.id, target.name);
      return fetchProductGraph(target.id, target.name);
    },
    enabled: !!target,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};
