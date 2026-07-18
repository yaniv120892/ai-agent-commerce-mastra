import { describe, expect, it } from 'vitest';
import {
  fixtureCatalog,
  fixtureCatalogWithUnknownValues,
  productWithUnknownCategory,
  productWithUnknownLogistics,
} from './__fixtures__/catalog';
import { collectUnknownValues, normalizeProduct } from './normalize';
import type { RawProduct, ReturnPolicy, ShippingInformation, WarrantyInformation } from './types';
import {
  RETURN_POLICY_VALUES,
  SHIPPING_INFORMATION_VALUES,
  WARRANTY_INFORMATION_VALUES,
} from './types';

const EXPECTED_SHIPPING_DAYS: Record<ShippingInformation, number> = {
  'Ships overnight': 1,
  'Ships in 1-2 business days': 2,
  'Ships in 3-5 business days': 5,
  'Ships in 1 week': 7,
  'Ships in 2 weeks': 14,
  'Ships in 1 month': 30,
};

const EXPECTED_RETURN_DAYS: Record<ReturnPolicy, number> = {
  'No return policy': 0,
  '7 days return policy': 7,
  '30 days return policy': 30,
  '60 days return policy': 60,
  '90 days return policy': 90,
};

const EXPECTED_WARRANTY_MONTHS: Record<WarrantyInformation, number> = {
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

function productWith(overrides: Partial<RawProduct>): RawProduct {
  return { ...fixtureCatalog[0], ...overrides };
}

describe('normalizeProduct enum mappings', () => {
  it.each(SHIPPING_INFORMATION_VALUES)('maps shipping "%s" to its day count', (shipping) => {
    expect(normalizeProduct(productWith({ shippingInformation: shipping })).shippingDays).toBe(
      EXPECTED_SHIPPING_DAYS[shipping],
    );
  });

  it.each(RETURN_POLICY_VALUES)('maps return policy "%s" to its day count', (returnPolicy) => {
    expect(normalizeProduct(productWith({ returnPolicy })).returnDays).toBe(
      EXPECTED_RETURN_DAYS[returnPolicy],
    );
  });

  it.each(WARRANTY_INFORMATION_VALUES)('maps warranty "%s" to its month count', (warranty) => {
    expect(normalizeProduct(productWith({ warrantyInformation: warranty })).warrantyMonths).toBe(
      EXPECTED_WARRANTY_MONTHS[warranty],
    );
  });

  it('maps a lifetime warranty to Infinity so it outranks every finite warranty', () => {
    const lifetime = normalizeProduct(productWith({ warrantyInformation: 'Lifetime warranty' }));
    expect(lifetime.warrantyMonths).toBe(Infinity);
    expect(lifetime.warrantyMonths).toBeGreaterThan(EXPECTED_WARRANTY_MONTHS['5 year warranty']);
  });

  it('maps no warranty to 0 rather than treating it as unmapped', () => {
    expect(
      normalizeProduct(productWith({ warrantyInformation: 'No warranty' })).warrantyMonths,
    ).toBe(0);
  });

  it('normalizes every fixture product without throwing', () => {
    expect(() => fixtureCatalog.map(normalizeProduct)).not.toThrow();
  });

  it('covers every enum value across the fixture catalog', () => {
    const normalized = fixtureCatalog.map(normalizeProduct);
    expect(new Set(normalized.map((product) => product.shippingDays)).size).toBe(
      SHIPPING_INFORMATION_VALUES.length,
    );
    expect(new Set(normalized.map((product) => product.returnDays)).size).toBe(
      RETURN_POLICY_VALUES.length,
    );
    expect(new Set(normalized.map((product) => product.warrantyMonths)).size).toBe(
      WARRANTY_INFORMATION_VALUES.length,
    );
  });
});

describe('normalizeProduct derived prices', () => {
  it('multiplies the $9.99 mascara by its minimum order quantity of 48 to 479.52', () => {
    const mascara = fixtureCatalog.find((product) => product.id === 1);
    expect(mascara).toBeDefined();
    if (!mascara) {
      return;
    }
    expect(mascara.price).toBe(9.99);
    expect(mascara.minimumOrderQuantity).toBe(48);
    expect(normalizeProduct(mascara).minimumSpend).toBe(479.52);
  });

  it('rounds away IEEE-754 drift that raw multiplication leaves behind', () => {
    const drifting = fixtureCatalog.find((product) => product.id === 26);
    expect(drifting).toBeDefined();
    if (!drifting) {
      return;
    }
    expect(drifting.price * drifting.minimumOrderQuantity).not.toBe(109.8);
    expect(normalizeProduct(drifting).minimumSpend).toBe(109.8);
  });

  it('rounds effective price to two decimals', () => {
    const discounted = normalizeProduct(productWith({ price: 9.99, discountPercentage: 10.48 }));
    expect(discounted.effectivePrice).toBe(8.94);
  });

  it('leaves an undiscounted price untouched', () => {
    expect(
      normalizeProduct(productWith({ price: 1749.99, discountPercentage: 0 })).effectivePrice,
    ).toBe(1749.99);
  });

  it('rounds every fixture derived price to at most two decimals', () => {
    for (const product of fixtureCatalog.map(normalizeProduct)) {
      expect(product.effectivePrice).toBe(Math.round(product.effectivePrice * 100) / 100);
      expect(product.minimumSpend).toBe(Math.round(product.minimumSpend * 100) / 100);
    }
  });

  it('keeps list price intact so filtering never reads the discounted value', () => {
    const normalized = normalizeProduct(productWith({ price: 9.99, discountPercentage: 10.48 }));
    expect(normalized.price).toBe(9.99);
  });
});

describe('normalizeProduct resilience', () => {
  it('normalizes a product with no brand', () => {
    const brandless = productWith({});
    delete brandless.brand;
    expect(() => normalizeProduct(brandless)).not.toThrow();
    expect(normalizeProduct(brandless).brand).toBeUndefined();
  });

  it('normalizes every brandless fixture product', () => {
    const brandless = fixtureCatalog.filter((product) => product.brand === undefined);
    expect(brandless.length).toBeGreaterThan(0);
    expect(() => brandless.map(normalizeProduct)).not.toThrow();
  });

  it.each([
    ['shippingInformation', 'Ships in 3 fortnights', 'shippingDays'],
    ['returnPolicy', '45 days return policy', 'returnDays'],
    ['warrantyInformation', 'Eternal warranty', 'warrantyMonths'],
  ] as const)(
    'maps an unrecognised %s to undefined instead of throwing',
    (field, value, mapped) => {
      const normalized = normalizeProduct(productWith({ [field]: value }));
      expect(normalized[mapped]).toBeUndefined();
    },
  );

  it('keeps the rest of the product intact when one logistics value is unrecognised', () => {
    const normalized = normalizeProduct(productWithUnknownLogistics);

    expect(normalized.shippingDays).toBeUndefined();
    expect(normalized.returnDays).toBeUndefined();
    expect(normalized.warrantyMonths).toBeUndefined();
    expect(normalized.title).toBe(productWithUnknownLogistics.title);
    expect(normalized.effectivePrice).toBeGreaterThan(0);
    expect(normalized.minimumSpend).toBeGreaterThan(0);
  });

  it('normalizes a product carrying a category outside the frozen slugs', () => {
    const normalized = normalizeProduct(productWithUnknownCategory);

    expect(normalized.category).toBe('electronics');
    expect(typeof normalized.shippingDays).toBe('number');
  });
});

describe('collectUnknownValues', () => {
  it('reports nothing for a catalog that uses only known values', () => {
    expect(collectUnknownValues(fixtureCatalog)).toEqual({});
  });

  it('reports the distinct unknown values per field', () => {
    expect(collectUnknownValues(fixtureCatalogWithUnknownValues)).toEqual({
      category: ['electronics'],
      shippingInformation: ['Ships via carrier pigeon'],
      returnPolicy: ['Returns accepted in another dimension'],
      warrantyInformation: ['Eternal warranty'],
    });
  });

  it('deduplicates a value repeated across products', () => {
    const repeated = [productWithUnknownCategory, { ...productWithUnknownCategory, id: 9003 }];
    expect(collectUnknownValues(repeated).category).toEqual(['electronics']);
  });
});
