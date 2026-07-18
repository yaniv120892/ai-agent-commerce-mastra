import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from './__fixtures__/catalog';
import { resolveProducts } from './resolve-products';
import type {
  NormalizedProduct,
  RawProduct,
  RetrievalCriteria,
  ReturnPolicy,
  ShippingInformation,
  WarrantyInformation,
} from './types';

const SHIPPING_DAYS: Record<ShippingInformation, number> = {
  'Ships overnight': 1,
  'Ships in 1-2 business days': 2,
  'Ships in 3-5 business days': 5,
  'Ships in 1 week': 7,
  'Ships in 2 weeks': 14,
  'Ships in 1 month': 30,
};

const RETURN_DAYS: Record<ReturnPolicy, number> = {
  'No return policy': 0,
  '7 days return policy': 7,
  '30 days return policy': 30,
  '60 days return policy': 60,
  '90 days return policy': 90,
};

const WARRANTY_MONTHS: Record<WarrantyInformation, number> = {
  'No warranty': 0,
  '1 week warranty': 0.25,
  '1 month warranty': 1,
  '3 months warranty': 3,
  '6 months warranty': 6,
  '1 year warranty': 12,
  '2 year warranty': 24,
  '3 year warranty': 36,
  '5 year warranty': 60,
  'Lifetime warranty': Infinity,
};

const APPLE_ELECTRONICS_TERMS = ['apple', 'laptop', 'tablet', 'smartphone'];

const catalog = fixtureCatalog.map((product) => toNormalizedProduct(product));

function toNormalizedProduct(product: RawProduct): NormalizedProduct {
  const effectivePrice = roundToCents(product.price * (1 - product.discountPercentage / 100));

  return {
    ...product,
    shippingDays: SHIPPING_DAYS[product.shippingInformation],
    returnDays: RETURN_DAYS[product.returnPolicy],
    warrantyMonths: WARRANTY_MONTHS[product.warrantyInformation],
    effectivePrice,
    minimumSpend: roundToCents(product.price * product.minimumOrderQuantity),
  };
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

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

function catalogIdsExcept(keptId: number): number[] {
  return catalog.map((product) => product.id).filter((id) => id !== keptId);
}
