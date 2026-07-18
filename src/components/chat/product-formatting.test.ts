import { describe, expect, it } from 'vitest';
import {
  formatDiscount,
  formatMinimumOrder,
  formatPrice,
  formatRating,
  hasMinimumOrder,
  isDiscounted,
} from './product-formatting';

describe('formatPrice', () => {
  it('renders two decimal places with a currency symbol', () => {
    expect(formatPrice(487.62)).toBe('$487.62');
  });

  it('renders whole amounts with trailing cents', () => {
    expect(formatPrice(9)).toBe('$9.00');
  });

  it('groups thousands', () => {
    expect(formatPrice(1749.99)).toBe('$1,749.99');
  });
});

describe('isDiscounted', () => {
  it('treats a zero discount as full price', () => {
    expect(isDiscounted(0)).toBe(false);
  });

  it('treats a discount that would round to zero percent as full price', () => {
    expect(isDiscounted(0.42)).toBe(false);
  });

  it('treats a visible discount as discounted', () => {
    expect(isDiscounted(11.02)).toBe(true);
  });
});

describe('formatDiscount', () => {
  it('rounds the percentage to a whole number', () => {
    expect(formatDiscount(11.02)).toBe('11% off');
  });

  it('rounds half percentages up', () => {
    expect(formatDiscount(10.5)).toBe('11% off');
  });
});

describe('formatRating', () => {
  it('renders one decimal place', () => {
    expect(formatRating(4.5)).toBe('4.5');
  });

  it('pads a whole-number rating', () => {
    expect(formatRating(5)).toBe('5.0');
  });
});

describe('hasMinimumOrder', () => {
  it('is false when a single unit can be bought', () => {
    expect(hasMinimumOrder(1)).toBe(false);
  });

  it('is true when the catalog forces a bulk order', () => {
    expect(hasMinimumOrder(48)).toBe(true);
  });
});

describe('formatMinimumOrder', () => {
  it('shows the quantity alongside what it actually costs', () => {
    expect(formatMinimumOrder(48, 479.52)).toBe('Min. order 48 · $479.52');
  });
});
