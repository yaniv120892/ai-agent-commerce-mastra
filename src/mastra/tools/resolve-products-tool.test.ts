import { noopObserve } from '@mastra/core/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog } from '@/catalog/__fixtures__/catalog';
import { resetCatalogCache } from '@/catalog/catalog-cache';
import { retrievalCriteriaSchema, type RetrievalCriteria } from '@/catalog/types';
import { resolveProductsTool } from './resolve-products-tool';
import {
  resolveProductsOutputSchema,
  type ResolveProductsOutput,
} from './resolve-products-tool.types';

const fetchMock = vi.fn<typeof fetch>();

// createTool types execute's result as `void | Output`; parsing through the output
// schema narrows it and asserts the tool actually honours its declared contract.
async function executeTool(criteria: RetrievalCriteria): Promise<ResolveProductsOutput> {
  const result = await resolveProductsTool.execute!(criteria, { observe: noopObserve });

  return resolveProductsOutputSchema.parse(result);
}

function jsonResponse(): Response {
  return new Response(JSON.stringify({ products: fixtureCatalog }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse());
  vi.stubGlobal('fetch', fetchMock);
  resetCatalogCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCatalogCache();
});

describe('resolveProductsTool', () => {
  it('exposes the shared retrieval criteria schema as its input schema', () => {
    expect(resolveProductsTool.id).toBe('resolveProducts');
    expect(resolveProductsTool.inputSchema).toBe(retrievalCriteriaSchema);
  });

  it('returns product cards for terms that match the catalog', async () => {
    const result = await executeTool({ searchTerms: ['mascara', 'beauty'] });

    expect(result.products.length).toBeGreaterThan(0);
    expect(result.resultCount).toBe(result.products.length);
  });

  it('echoes the criteria it was called with', async () => {
    const criteria = { searchTerms: ['mascara'], maxPrice: 15, minRating: 4.5 };

    const result = await executeTool(criteria);

    expect(result.criteria).toEqual(criteria);
  });

  it('applies hard filters from the criteria', async () => {
    const result = await executeTool({ searchTerms: ['beauty'], maxPrice: 10 });

    for (const product of result.products) {
      expect(product.price).toBeLessThanOrEqual(10);
    }
  });

  it('surfaces minimumSpend so the caller can flag minimum order quantities', async () => {
    const result = await executeTool({ searchTerms: ['mascara'] });

    const mascara = result.products.find((product) => product.id === 1);
    expect(mascara).toBeDefined();
    expect(mascara?.minimumOrderQuantity).toBe(48);
    expect(mascara?.minimumSpend).toBe(479.52);
  });

  it('returns an empty result rather than throwing when nothing matches', async () => {
    const result = await executeTool({ searchTerms: ['zzzznotathing'] });

    expect(result.products).toEqual([]);
    expect(result.resultCount).toBe(0);
  });

  it('caps results at six and reuses the cached catalog across calls', async () => {
    const first = await executeTool({ searchTerms: ['beauty'] });
    await executeTool({ searchTerms: ['beauty'] });

    expect(first.products.length).toBeLessThanOrEqual(6);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
