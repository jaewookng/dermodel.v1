import { useState } from 'react';
import type { Product } from '@/hooks/useIngredients';

/**
 * Product photo at the top of an expanded product card, above the
 * ingredients list. Images are hotlinked from their source (SkinSafe CDN) —
 * never copied or proxied — so:
 *  - referrerPolicy="no-referrer" avoids referer-based hotlink blocking
 *  - onError hides the block entirely if the origin removes the file
 *  - a small credit line links back to the source page
 */
export const ProductImage = ({ product }: { product: Product }) => {
  const [broken, setBroken] = useState(false);

  if (!product.image_url || broken) {
    return null;
  }

  return (
    <div className="mb-2">
      <img
        src={product.image_url}
        alt={product.product_name}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-full max-h-64 rounded border bg-white object-contain p-3"
      />
      {product.image_source_url && (
        <a
          href={product.image_source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block text-[10px] text-gray-400 hover:text-gray-600 hover:underline"
        >
          Image: {product.image_attribution || 'source'}
        </a>
      )}
    </div>
  );
};
