import { describe, expect, it } from 'vitest';
import {
  fixtureCatalog,
  productWithUnknownCategory,
  productWithUnknownLogistics,
} from './__fixtures__/catalog';
import { normalizeProduct } from './normalize';
import { resolveProducts, resolveProductsWithTotals } from './resolve-products';
import type { RetrievalCriteria } from './types';

const APPLE_ELECTRONICS_TERMS = ['apple', 'laptop', 'tablet', 'smartphone'];

const catalog = fixtureCatalog.map((product) => normalizeProduct(product));

function idsOf(cards: { id: number }[]): number[] {
  return cards.map((card) => card.id);
}

describe('resolveProducts hard filters', () => {
  it('never returns an item above maxPrice', () => {
    const cards = resolveProducts({ searchTerms: ['phone'], maxPrice: 400 }, catalog);

    expect(idsOf(cards)).toContain(141);
    expect(idsOf(cards)).not.toContain(142);
    for (const card of cards) {
      expect(card.price).toBeLessThanOrEqual(400);
    }
  });

  it('filters on list price rather than effectivePrice', () => {
    const galaxy = catalog.find((product) => product.id === 142);

    expect(galaxy?.effectivePrice).toBeLessThan(400);
    expect(
      idsOf(resolveProducts({ searchTerms: ['phone'], maxPrice: 400 }, catalog)),
    ).not.toContain(142);
  });

  it('applies minPrice', () => {
    const cards = resolveProducts({ searchTerms: ['apple'], minPrice: 500 }, catalog);

    expect(idsOf(cards)).not.toContain(20);
    for (const card of cards) {
      expect(card.price).toBeGreaterThanOrEqual(500);
    }
  });

  it('keeps only products at or above minRating', () => {
    const cards = resolveProducts(
      { searchTerms: APPLE_ELECTRONICS_TERMS, minRating: 4.5 },
      catalog,
    );

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.rating).toBeGreaterThanOrEqual(4.5);
    }
    expect(idsOf(cards)).toContain(141);
    expect(idsOf(cards)).not.toContain(121);
  });

  it('restricts to a category slug', () => {
    const cards = resolveProducts({ searchTerms: [], categorySlug: 'laptops' }, catalog);

    expect(idsOf(cards).sort((left, right) => left - right)).toEqual([121, 122, 123]);
  });

  it('excludes Out of Stock but keeps Low Stock when inStock is set', () => {
    const cards = resolveProducts({ searchTerms: [], inStock: true }, catalog);
    const inStockIds = idsOf(
      resolveProducts({ searchTerms: [], inStock: true, categorySlug: 'laptops' }, catalog),
    );

    expect(inStockIds).toContain(122);
    expect(inStockIds).not.toContain(123);
    for (const card of cards) {
      expect(card.availabilityStatus).not.toBe('Out of Stock');
    }

    const lowStockIds = [2, 26, 122, 172];
    for (const lowStockId of lowStockIds) {
      const single = resolveProducts(
        { searchTerms: [], inStock: true, excludeProductIds: catalogIdsExcept(lowStockId) },
        catalog,
      );
      expect(idsOf(single)).toEqual([lowStockId]);
    }

    for (const outOfStockId of [8, 123]) {
      const single = resolveProducts(
        { searchTerms: [], inStock: true, excludeProductIds: catalogIdsExcept(outOfStockId) },
        catalog,
      );
      expect(single).toEqual([]);
    }
  });

  it('applies shipping and return-window filters', () => {
    const fastCards = resolveProducts({ searchTerms: [], maxShippingDays: 2 }, catalog);
    for (const card of fastCards) {
      const product = catalog.find((entry) => entry.id === card.id);
      expect(product?.shippingDays).toBeLessThanOrEqual(2);
    }

    const returnableCards = resolveProducts({ searchTerms: [], minReturnDays: 60 }, catalog);
    for (const card of returnableCards) {
      const product = catalog.find((entry) => entry.id === card.id);
      expect(product?.returnDays).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('resolveProducts with unnormalized logistics values', () => {
  const driftedCatalog = [...catalog, normalizeProduct(productWithUnknownLogistics)];

  it('returns a product with unknown shipping when no shipping filter is active', () => {
    const cards = resolveProducts({ searchTerms: ['teleporting'] }, driftedCatalog);

    expect(cards.map((card) => card.id)).toContain(productWithUnknownLogistics.id);
  });

  it('excludes a product with unknown shipping once maxShippingDays is set', () => {
    const cards = resolveProducts(
      { searchTerms: ['teleporting'], maxShippingDays: 30 },
      driftedCatalog,
    );

    expect(cards.map((card) => card.id)).not.toContain(productWithUnknownLogistics.id);
  });

  it('excludes a product with unknown return policy once minReturnDays is set', () => {
    const cards = resolveProducts(
      { searchTerms: ['teleporting'], minReturnDays: 0 },
      driftedCatalog,
    );

    expect(cards.map((card) => card.id)).not.toContain(productWithUnknownLogistics.id);
  });

  it('keeps a product whose category drifted outside the frozen slugs searchable by text', () => {
    const withUnknownCategory = [...catalog, normalizeProduct(productWithUnknownCategory)];

    const cards = resolveProducts({ searchTerms: ['quantum'] }, withUnknownCategory);

    expect(cards.map((card) => card.id)).toContain(productWithUnknownCategory.id);
  });
});

describe('resolveProducts lexical scoring', () => {
  it('resolves the three multi-word queries that upstream /products/search returns zero results for', () => {
    const cheapPhone = resolveProducts({ searchTerms: ['cheap phone'], maxPrice: 500 }, catalog);
    const reversedWordOrder = resolveProducts({ searchTerms: ['iPhone Apple'] }, catalog);
    const categorySlugAsQuery = resolveProducts({ searchTerms: ['beauty'] }, catalog);

    expect(idsOf(cheapPhone)).toContain(141);
    expect(idsOf(reversedWordOrder)[0]).toBe(141);
    expect(idsOf(categorySlugAsQuery).length).toBeGreaterThan(0);
    for (const card of categorySlugAsQuery) {
      expect(card.category).toBe('beauty');
    }
  });

  it('matches terms in any order and across different fields', () => {
    const titleThenBrand = resolveProducts({ searchTerms: ['iphone', 'apple'] }, catalog);
    const brandThenTitle = resolveProducts({ searchTerms: ['apple', 'iphone'] }, catalog);

    expect(idsOf(titleThenBrand)[0]).toBe(141);
    expect(idsOf(brandThenTitle)).toEqual(idsOf(titleThenBrand));
  });

  it('matches terms that appear only in the description', () => {
    const cards = resolveProducts(
      { searchTerms: ['heat resistant', 'non-stick cookware'] },
      catalog,
    );

    expect(idsOf(cards)[0]).toBe(79);
  });

  it('does not rank the grocery apple above Apple electronics', () => {
    const ranking = idsOf(resolveProducts({ searchTerms: APPLE_ELECTRONICS_TERMS }, catalog));
    const groceryApplePosition = ranking.indexOf(20);

    expect(groceryApplePosition).toBeGreaterThan(-1);
    for (const electronicsId of [121, 131, 141]) {
      expect(ranking.indexOf(electronicsId)).toBeGreaterThan(-1);
      expect(ranking.indexOf(electronicsId)).toBeLessThan(groceryApplePosition);
    }
  });

  it('ranks an exact title match first', () => {
    expect(idsOf(resolveProducts({ searchTerms: ['Dell XPS 13'] }, catalog))[0]).toBe(122);
  });

  it('caps the result set at six cards', () => {
    expect(resolveProducts({ searchTerms: [] }, catalog).length).toBe(6);
  });
});

describe('resolveProducts exclusions', () => {
  it('excludes a brand by title when the brand field is absent', () => {
    const withoutExclusion = idsOf(resolveProducts({ searchTerms: ['apple'] }, catalog));
    const withExclusion = idsOf(
      resolveProducts({ searchTerms: ['apple'], excludeBrands: ['Apple'] }, catalog),
    );

    expect(catalog.find((product) => product.id === 20)?.brand).toBeUndefined();
    expect(withoutExclusion).toContain(20);
    expect(withExclusion).not.toContain(20);
    for (const appleId of [121, 131, 141]) {
      expect(withExclusion).not.toContain(appleId);
    }
  });

  it('does not let a short brand name match a coincidental substring', () => {
    // "le" sits inside Palette, Klein, Apple and Rolex without naming any of their brands.
    const withoutExclusion = idsOf(resolveProducts({ searchTerms: [] }, catalog));
    const withExclusion = idsOf(
      resolveProducts({ searchTerms: [], excludeBrands: ['le'] }, catalog),
    );

    expect(withExclusion).toEqual(withoutExclusion);
  });

  it('still excludes a short brand name that stands as its own word', () => {
    const calvinKleinId = 6;

    expect(catalog.find((product) => product.id === calvinKleinId)?.title).toContain('CK');
    expect(idsOf(resolveProducts({ searchTerms: ['ck'] }, catalog))).toContain(calvinKleinId);
    expect(
      idsOf(resolveProducts({ searchTerms: ['ck'], excludeBrands: ['CK'] }, catalog)),
    ).not.toContain(calvinKleinId);
  });

  it('never hard-filters on brand for products missing the field', () => {
    const cards = resolveProducts(
      { searchTerms: [], categorySlug: 'kitchen-accessories' },
      catalog,
    );

    expect(idsOf(cards).sort((left, right) => left - right)).toEqual([79, 80]);
  });

  it('returns a fully non-overlapping second page for "show me more"', () => {
    const firstPage = idsOf(resolveProducts({ searchTerms: [] }, catalog));
    const secondPage = idsOf(
      resolveProducts({ searchTerms: [], excludeProductIds: firstPage }, catalog),
    );

    expect(firstPage.length).toBe(6);
    expect(secondPage.length).toBe(6);
    for (const id of secondPage) {
      expect(firstPage).not.toContain(id);
    }
  });
});

describe('resolveProducts sorting', () => {
  it('orders by each of the five sort options', () => {
    const laptops: RetrievalCriteria = { searchTerms: [], categorySlug: 'laptops' };

    expect(idsOf(resolveProducts({ ...laptops, sort: 'price-asc' }, catalog))).toEqual([
      122, 123, 121,
    ]);
    expect(idsOf(resolveProducts({ ...laptops, sort: 'price-desc' }, catalog))).toEqual([
      121, 123, 122,
    ]);
    expect(idsOf(resolveProducts({ ...laptops, sort: 'rating-desc' }, catalog))).toEqual([
      122, 121, 123,
    ]);
    expect(idsOf(resolveProducts({ ...laptops, sort: 'discount-desc' }, catalog))).toEqual([
      122, 123, 121,
    ]);
    expect(idsOf(resolveProducts({ ...laptops, sort: 'relevance' }, catalog))).toEqual([
      122, 121, 123,
    ]);
  });

  it('treats an omitted sort as relevance', () => {
    const explicit = resolveProducts({ searchTerms: ['apple'], sort: 'relevance' }, catalog);
    const implicit = resolveProducts({ searchTerms: ['apple'] }, catalog);

    expect(idsOf(implicit)).toEqual(idsOf(explicit));
  });

  it('breaks ties by id so identical criteria produce identical order', () => {
    const first = idsOf(resolveProducts({ searchTerms: APPLE_ELECTRONICS_TERMS }, catalog));
    const second = idsOf(
      resolveProducts({ searchTerms: APPLE_ELECTRONICS_TERMS }, [...catalog].reverse()),
    );

    expect(second).toEqual(first);
  });
});

describe('resolveProducts empty results', () => {
  it('returns an empty array instead of throwing when nothing matches', () => {
    expect(resolveProducts({ searchTerms: ['helicopter'] }, catalog)).toEqual([]);
    expect(resolveProducts({ searchTerms: ['phone'], maxPrice: 1 }, catalog)).toEqual([]);
    expect(resolveProducts({ searchTerms: ['phone'] }, [])).toEqual([]);
  });
});

describe('resolveProducts card mapping', () => {
  it('maps every ProductCard field and truncates the description', () => {
    const [card] = resolveProducts({ searchTerms: [], categorySlug: 'smartphones' }, catalog);
    const product = catalog.find((entry) => entry.id === card.id);

    expect(product).toBeDefined();
    expect(card.effectivePrice).toBe(product?.effectivePrice);
    expect(card.minimumSpend).toBe(product?.minimumSpend);
    expect(card.minimumOrderQuantity).toBe(product?.minimumOrderQuantity);
    expect(card.thumbnail).toBe(product?.thumbnail);
    expect(card.category).toBe(product?.category);
    expect(card.availabilityStatus).toBe(product?.availabilityStatus);
    expect(card.shortDescription.length).toBeLessThanOrEqual(141);
  });

  it('truncates long descriptions with an ellipsis and keeps short ones intact', () => {
    const longDescriptionCard = resolveProducts(
      { searchTerms: [], categorySlug: 'beauty' },
      catalog,
    ).find((card) => card.id === 1);
    const shortDescriptionCard = resolveProducts(
      { searchTerms: [], categorySlug: 'groceries' },
      catalog,
    ).find((card) => card.id === 23);

    expect(longDescriptionCard?.shortDescription.endsWith('…')).toBe(true);
    expect(shortDescriptionCard?.shortDescription.endsWith('…')).toBe(false);
  });
});

describe('resolveProductsWithTotals', () => {
  it('reports the pre-truncation total when the result set is capped', () => {
    const result = resolveProductsWithTotals({ searchTerms: [] }, catalog);

    expect(result.products).toHaveLength(6);
    expect(result.totalMatched).toBe(catalog.length);
  });

  it('reports totalMatched equal to the card count when nothing was truncated', () => {
    const result = resolveProductsWithTotals({ searchTerms: [], categorySlug: 'laptops' }, catalog);

    expect(result.totalMatched).toBe(result.products.length);
  });

  it('reports how many matched but did not fit on this page', () => {
    const result = resolveProductsWithTotals({ searchTerms: [] }, catalog);

    expect(result.products).toHaveLength(6);
    expect(result.remainingAfterThisPage).toBe(catalog.length - 6);
  });

  it('reports zero remaining when every match fit on the page', () => {
    const result = resolveProductsWithTotals({ searchTerms: [], categorySlug: 'laptops' }, catalog);

    expect(result.products.length).toBeLessThan(6);
    expect(result.remainingAfterThisPage).toBe(0);
  });

  it('counts the page itself out of the remainder on a second page', () => {
    const firstPage = resolveProductsWithTotals({ searchTerms: [] }, catalog);
    const secondPage = resolveProductsWithTotals(
      { searchTerms: [], excludeProductIds: firstPage.products.map((product) => product.id) },
      catalog,
    );

    expect(secondPage.totalMatched).toBe(catalog.length - 6);
    expect(secondPage.remainingAfterThisPage).toBe(
      secondPage.totalMatched - secondPage.products.length,
    );
  });

  it('never reports a negative remainder, whatever the criteria', () => {
    const criteriaVariants: RetrievalCriteria[] = [
      { searchTerms: [] },
      { searchTerms: ['laptop'] },
      { searchTerms: ['nonexistent-term'] },
      { searchTerms: [], categorySlug: 'laptops' },
      { searchTerms: ['phone'], maxPrice: 400 },
    ];

    for (const criteria of criteriaVariants) {
      const result = resolveProductsWithTotals(criteria, catalog);

      expect(result.remainingAfterThisPage).toBeGreaterThanOrEqual(0);
      expect(result.remainingAfterThisPage).toBe(result.totalMatched - result.products.length);
    }
  });

  it('counts what the category filter hid, so a narrow search cannot look catalog-wide', () => {
    const result = resolveProductsWithTotals(
      { searchTerms: ['apple'], categorySlug: 'laptops' },
      catalog,
    );

    expect(result.totalMatched).toBe(1);
    expect(result.totalMatchedWithoutCategoryFilter).toBeGreaterThan(result.totalMatched);
  });

  it('counts the whole category regardless of search terms that failed to score', () => {
    const result = resolveProductsWithTotals(
      { searchTerms: ['nonexistent-term'], categorySlug: 'groceries' },
      catalog,
    );

    expect(result.totalMatched).toBe(0);
    expect(result.totalInCategory).toBe(3);
  });

  it('leaves both category counts undefined when no category was requested', () => {
    const result = resolveProductsWithTotals({ searchTerms: ['laptop'] }, catalog);

    expect(result.totalMatchedWithoutCategoryFilter).toBeUndefined();
    expect(result.totalInCategory).toBeUndefined();
  });

  it('returns the same cards resolveProducts does', () => {
    const criteria = { searchTerms: ['phone'], maxPrice: 400 };

    expect(resolveProductsWithTotals(criteria, catalog).products).toEqual(
      resolveProducts(criteria, catalog),
    );
  });
});

function catalogIdsExcept(keptId: number): number[] {
  return catalog.map((product) => product.id).filter((id) => id !== keptId);
}
