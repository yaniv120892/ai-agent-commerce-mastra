import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from './__fixtures__/catalog';
import {
  CATEGORY_SLUGS,
  RETURN_POLICY_VALUES,
  SHIPPING_INFORMATION_VALUES,
  WARRANTY_INFORMATION_VALUES,
  rawProductSchema,
} from './types';

describe('rawProductSchema', () => {
  it('accepts every fixture product', () => {
    for (const product of fixtureCatalog) {
      expect(rawProductSchema.safeParse(product).success).toBe(true);
    }
  });

  it('accepts a product with no brand', () => {
    const brandless = { ...fixtureCatalog[0] };
    delete brandless.brand;
    expect(rawProductSchema.safeParse(brandless).success).toBe(true);
  });

  it('rejects a category slug outside the 24 real categories', () => {
    expect(
      rawProductSchema.safeParse({ ...fixtureCatalog[0], category: 'electronics' }).success,
    ).toBe(false);
  });
});

describe('fixtureCatalog', () => {
  it('exposes unique product ids', () => {
    const ids = fixtureCatalog.map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only real category slugs', () => {
    for (const product of fixtureCatalog) {
      expect(CATEGORY_SLUGS).toContain(product.category);
    }
  });

  it('includes products with a missing brand', () => {
    expect(fixtureCatalog.some((product) => product.brand === undefined)).toBe(true);
  });

  it('includes the mascara whose minimum order quantity dwarfs its unit price', () => {
    const mascara = fixtureCatalog.find((product) => product.id === 1);
    expect(mascara?.price).toBe(9.99);
    expect(mascara?.minimumOrderQuantity).toBe(48);
  });

  it('includes out of stock and low stock products', () => {
    const statuses = fixtureCatalog.map((product) => product.availabilityStatus);
    expect(statuses).toContain('Out of Stock');
    expect(statuses).toContain('Low Stock');
  });

  it('includes a lifetime warranty product and a no return policy product', () => {
    expect(
      fixtureCatalog.some((product) => product.warrantyInformation === 'Lifetime warranty'),
    ).toBe(true);
    expect(fixtureCatalog.some((product) => product.returnPolicy === 'No return policy')).toBe(
      true,
    );
  });

  it('straddles the $400 price boundary on both sides', () => {
    expect(fixtureCatalog.some((product) => product.price < 400)).toBe(true);
    expect(fixtureCatalog.some((product) => product.price > 400)).toBe(true);
  });

  it('contains both a grocery apple and Apple electronics', () => {
    const groceryApple = fixtureCatalog.find(
      (product) => product.title === 'Apple' && product.category === 'groceries',
    );
    const appleElectronics = fixtureCatalog.filter((product) => product.brand === 'Apple');
    expect(groceryApple?.price).toBeLessThan(10);
    expect(appleElectronics.length).toBeGreaterThan(1);
  });

  it('contains a product whose search terms live only in its description', () => {
    const spatula = fixtureCatalog.find((product) => product.id === 79);
    expect(spatula?.description).toContain('Heat resistant');
    expect(spatula?.title).not.toContain('Heat resistant');
  });

  it('covers every shipping, return, and warranty enum value used downstream', () => {
    const shippingValues = new Set(fixtureCatalog.map((product) => product.shippingInformation));
    const returnValues = new Set(fixtureCatalog.map((product) => product.returnPolicy));
    const warrantyValues = new Set(fixtureCatalog.map((product) => product.warrantyInformation));

    expect(shippingValues.size).toBe(SHIPPING_INFORMATION_VALUES.length);
    expect(returnValues.size).toBe(RETURN_POLICY_VALUES.length);
    expect(warrantyValues.size).toBe(WARRANTY_INFORMATION_VALUES.length);
  });
});
