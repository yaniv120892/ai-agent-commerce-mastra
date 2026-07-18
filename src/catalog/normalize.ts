import { CATEGORY_SLUGS } from './types';
import type {
  NormalizedProduct,
  RawProduct,
  ReturnPolicy,
  ShippingInformation,
  WarrantyInformation,
} from './types';

export function normalizeProduct(raw: RawProduct): NormalizedProduct {
  return {
    ...raw,
    shippingDays: SHIPPING_DAYS.get(raw.shippingInformation),
    returnDays: RETURN_DAYS.get(raw.returnPolicy),
    warrantyMonths: WARRANTY_MONTHS.get(raw.warrantyInformation),
    effectivePrice: roundToCents(raw.price * (1 - raw.discountPercentage / 100)),
    minimumSpend: roundToCents(raw.price * raw.minimumOrderQuantity),
  };
}

export function collectUnknownValues(products: RawProduct[]): Record<string, string[]> {
  const unknownByField: Record<string, Set<string>> = {
    category: new Set(),
    shippingInformation: new Set(),
    returnPolicy: new Set(),
    warrantyInformation: new Set(),
  };

  for (const product of products) {
    if (!KNOWN_CATEGORIES.has(product.category)) {
      unknownByField.category.add(product.category);
    }
    if (!SHIPPING_DAYS.has(product.shippingInformation)) {
      unknownByField.shippingInformation.add(product.shippingInformation);
    }
    if (!RETURN_DAYS.has(product.returnPolicy)) {
      unknownByField.returnPolicy.add(product.returnPolicy);
    }
    if (!WARRANTY_MONTHS.has(product.warrantyInformation)) {
      unknownByField.warrantyInformation.add(product.warrantyInformation);
    }
  }

  const populatedFields: Record<string, string[]> = {};
  for (const [fieldName, values] of Object.entries(unknownByField)) {
    if (values.size > 0) {
      populatedFields[fieldName] = [...values].sort();
    }
  }

  return populatedFields;
}

const SHIPPING_DAYS_BY_INFORMATION = {
  'Ships overnight': 1,
  'Ships in 1-2 business days': 2,
  'Ships in 3-5 business days': 5,
  'Ships in 1 week': 7,
  'Ships in 2 weeks': 14,
  'Ships in 1 month': 30,
} satisfies Record<ShippingInformation, number>;

const RETURN_DAYS_BY_POLICY = {
  'No return policy': 0,
  '7 days return policy': 7,
  '30 days return policy': 30,
  '60 days return policy': 60,
  '90 days return policy': 90,
} satisfies Record<ReturnPolicy, number>;

const WARRANTY_MONTHS_BY_INFORMATION = {
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
} satisfies Record<WarrantyInformation, number>;

const SHIPPING_DAYS: ReadonlyMap<string, number> = new Map(
  Object.entries(SHIPPING_DAYS_BY_INFORMATION),
);
const RETURN_DAYS: ReadonlyMap<string, number> = new Map(Object.entries(RETURN_DAYS_BY_POLICY));
const WARRANTY_MONTHS: ReadonlyMap<string, number> = new Map(
  Object.entries(WARRANTY_MONTHS_BY_INFORMATION),
);

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(CATEGORY_SLUGS);

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
