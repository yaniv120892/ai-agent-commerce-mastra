import { createTool } from '@mastra/core/tools';
import { getNormalizedCatalog } from '@/catalog/catalog-cache';
import { resolveProducts } from '@/catalog/resolve-products';
import { retrievalCriteriaSchema } from '@/catalog/types';
import { resolveProductsOutputSchema } from './resolve-products-tool.types';

export { resolveProductsOutputSchema };
export type { ResolveProductsOutput } from './resolve-products-tool.types';

const TOOL_DESCRIPTION = `Searches the product catalog and returns up to 6 matching product cards. Call this before saying anything about a specific product, price, rating, or availability — it is the only source of catalog data.

searchTerms is a list of short, specific terms, not a sentence. Each term is scored separately and the total is scaled by how many of your terms matched, so several distinct terms beat one long phrase: ["laptop", "apple", "macbook"] works, ["apple laptop for work"] does not. Split compound ideas into parts, include the product noun and obvious synonyms, and leave out filler words like "cheap", "best", or "under".

Express constraints as fields rather than terms: maxPrice/minPrice for budget (matched against list price), minRating for quality (use 4.5 for "highly rated" — the catalog median is 3.86), inStock for availability, maxShippingDays for urgency, minReturnDays for returnability, categorySlug for a known category, excludeBrands and excludeProductIds to suppress results already shown or rejected.

Call it once per distinct thing the shopper asked for. Two intents ("a phone and a laptop") means two calls, never one blended query.`;

export const resolveProductsTool = createTool({
  id: 'resolveProducts',
  description: TOOL_DESCRIPTION,
  inputSchema: retrievalCriteriaSchema,
  outputSchema: resolveProductsOutputSchema,
  execute: async (inputData) => {
    const catalog = await getNormalizedCatalog();
    const products = resolveProducts(inputData, catalog);

    return { products, resultCount: products.length, criteria: inputData };
  },
});
