import { noopObserve } from '@mastra/core/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog } from '@/catalog/__fixtures__/catalog';
import { resetCatalogCache } from '@/catalog/catalog-cache';
import { retrievalCriteriaSchema } from '@/catalog/types';
import { resolveProductsTool } from './resolve-products-tool';
import {
  resolveProductsInputSchema,
  resolveProductsOutputSchema,
  type ResolveProductsInput,
  type ResolveProductsOutput,
} from './resolve-products-tool.types';

const fetchMock = vi.fn<typeof fetch>();

// createTool types execute's result as `void | Output`; parsing through the output
// schema narrows it and asserts the tool actually honours its declared contract.
async function executeTool(criteria: ResolveProductsInput): Promise<ResolveProductsOutput> {
  const result = await resolveProductsTool.execute!(criteria, { observe: noopObserve });

  return resolveProductsOutputSchema.parse(result);
}

function isToolInputValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    result.error === true &&
    'message' in result &&
    typeof result.message === 'string'
  );
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
  it('accepts the shared retrieval criteria, and additionally a null enum field', () => {
    expect(resolveProductsTool.id).toBe('resolveProducts');
    expect(resolveProductsInputSchema.safeParse({ searchTerms: ['mascara'] }).success).toBe(true);

    // The input schema deliberately diverges from the shared one on exactly this point:
    // OpenAI's strict transform cannot express an omitted optional enum, so the model can
    // only say "no category" by sending null. The shared schema still rejects it, which is
    // why the tool strips nulls before the criteria reach the catalog layer.
    const nulledEnums = { searchTerms: [], categorySlug: null, sort: null };
    expect(resolveProductsInputSchema.safeParse(nulledEnums).success).toBe(true);
    expect(retrievalCriteriaSchema.safeParse(nulledEnums).success).toBe(false);
  });

  it('rejects an empty searchTerms list carrying a categorySlug', () => {
    const result = resolveProductsInputSchema.safeParse({
      searchTerms: [],
      categorySlug: 'beauty',
    });

    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path).toEqual(['categorySlug']);
    expect(issue?.message).toContain('beauty');
  });

  it.each([
    ['an empty list with no category at all', { searchTerms: [] }],
    ['an empty list with an explicitly null category', { searchTerms: [], categorySlug: null }],
    [
      'a category alongside real search terms',
      { searchTerms: ['mascara'], categorySlug: 'beauty' },
    ],
  ])('still accepts %s', (_label, input) => {
    expect(resolveProductsInputSchema.safeParse(input).success).toBe(true);
  });

  it('hands the model a correctable tool result rather than throwing on the contradictory pair', async () => {
    const result = await resolveProductsTool.execute!(
      { searchTerms: [], categorySlug: 'beauty' },
      { observe: noopObserve },
    );

    expect(isToolInputValidationError(result)).toBe(true);
    if (isToolInputValidationError(result)) {
      expect(result.message).toContain('categorySlug');
      expect(result.message).toContain('beauty');
    }
  });

  it('treats a null categorySlug as no category filter rather than as a filter matching nothing', async () => {
    const result = await executeTool({ searchTerms: ['mascara'], categorySlug: null, sort: null });

    expect(result.products.length).toBeGreaterThan(0);
    expect(result.criteria).toEqual({ searchTerms: ['mascara'] });
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
