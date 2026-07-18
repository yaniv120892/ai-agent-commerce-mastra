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
    shippingDays: lookupOrThrow(SHIPPING_DAYS, raw.shippingInformation, {
      fieldName: 'shippingInformation',
      productId: raw.id,
    }),
    returnDays: lookupOrThrow(RETURN_DAYS, raw.returnPolicy, {
      fieldName: 'returnPolicy',
      productId: raw.id,
    }),
    warrantyMonths: lookupOrThrow(WARRANTY_MONTHS, raw.warrantyInformation, {
      fieldName: 'warrantyInformation',
      productId: raw.id,
    }),
    effectivePrice: roundToCents(raw.price * (1 - raw.discountPercentage / 100)),
    minimumSpend: roundToCents(raw.price * raw.minimumOrderQuantity),
  };
}

export class UnknownCatalogEnumValueError extends Error {
  public readonly fieldName: string;
  public readonly value: string;
  public readonly productId: number;

  public constructor(fieldName: string, value: string, productId: number, knownValues: string[]) {
    super(
      `Unrecognised ${fieldName} value "${value}" on product ${productId}. ` +
        `Known values: ${knownValues.join(', ')}.`,
    );
    this.name = 'UnknownCatalogEnumValueError';
    this.fieldName = fieldName;
    this.value = value;
    this.productId = productId;
  }
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

type LookupContext = {
  fieldName: string;
  productId: number;
};

function lookupOrThrow(
  mapping: ReadonlyMap<string, number>,
  value: string,
  { fieldName, productId }: LookupContext,
): number {
  const numericValue = mapping.get(value);
  if (numericValue === undefined) {
    throw new UnknownCatalogEnumValueError(fieldName, value, productId, [...mapping.keys()]);
  }
  return numericValue;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
