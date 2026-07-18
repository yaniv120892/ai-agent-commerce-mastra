import { createTool } from '@mastra/core/tools';
import { getNormalizedCatalog } from '@/catalog/catalog-cache';
import { resolveProducts } from '@/catalog/resolve-products';
import { retrievalCriteriaSchema } from '@/catalog/types';
import type { RetrievalCriteria } from '@/catalog/types';
import {
  resolveProductsInputSchema,
  resolveProductsOutputSchema,
  type ResolveProductsInput,
} from './resolve-products-tool.types';

export { resolveProductsInputSchema, resolveProductsOutputSchema };
export type { ResolveProductsInput, ResolveProductsOutput } from './resolve-products-tool.types';

const TOOL_DESCRIPTION = `Searches the product catalog and returns up to 6 matching product cards. Call this before saying anything about a specific product, price, rating, or availability — it is the only source of catalog data.

searchTerms is a list of short, specific terms, not a sentence. Each term is scored separately and the total is scaled by how many of your terms matched, so several distinct terms beat one long phrase: ["laptop", "apple", "macbook"] works, ["apple laptop for work"] does not. Split compound ideas into parts, include the product noun and obvious synonyms, and leave out filler words like "cheap", "best", or "under". Send it empty when the request names no particular thing — a placeholder term every product shares, like "product", carries no signal and only adds noise.

Express constraints as fields rather than terms: maxPrice/minPrice for budget (matched against list price), minRating for quality (use 4.5 for "highly rated" — the catalog median is 3.86), inStock for availability, maxShippingDays for urgency, minReturnDays for returnability, excludeBrands and excludeProductIds to suppress results already shown or rejected. sort (relevance, price-asc, price-desc, rating-desc, discount-desc) answers a superlative better than a filter does.

categorySlug is a hard filter that hides everything outside it, so set it only when the shopper named a category or an unambiguous product type. If searchTerms is empty, categorySlug must be omitted: the two fields must agree about how wide the search is, and there is no neutral default category.

Call it once per distinct thing the shopper asked for. Two intents ("a phone and a laptop") means two calls, never one blended query — but one broad question ("your highest rated products") means one wide call, never one call per guessed category.`;

export const resolveProductsTool = createTool({
  id: 'resolveProducts',
  description: TOOL_DESCRIPTION,
  inputSchema: resolveProductsInputSchema,
  outputSchema: resolveProductsOutputSchema,
  execute: async (inputData) => {
    const criteria = toRetrievalCriteria(inputData);
    const catalog = await getNormalizedCatalog();
    const products = resolveProducts(criteria, catalog);

    return { products, resultCount: products.length, criteria };
  },
});

// `resolveProducts` distinguishes an absent filter by `!== undefined`, so a null arriving
// from the model would read as a real filter and match nothing.
function toRetrievalCriteria(input: ResolveProductsInput): RetrievalCriteria {
  const populatedFields: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) {
    if (value !== null) {
      populatedFields[field] = value;
    }
  }

  return retrievalCriteriaSchema.parse(populatedFields);
}
