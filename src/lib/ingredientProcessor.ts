// Processed ingredient for UI display (from sss_ingredients table)
export interface ProcessedIngredient {
  id: string;
  name: string;
  description: string;
  benefits: string[];
  skinTypes: string[];
  concerns: string[];
  casNumber?: string;
  route?: string;
  potency?: string;
  maxExposure?: string;
  sources: string[];
  functions: string[];
  restriction?: string;
  ecNumber?: string;
  // From sss_ingredients table
  productCount?: number;
  avgPosition?: number | null;
  // Popularity: times this ingredient is cited in users' liked products (global)
  likeCount?: number;
}
