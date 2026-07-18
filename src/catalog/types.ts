import { z } from 'zod';

export const CATEGORY_SLUGS = [
  'beauty',
  'fragrances',
  'furniture',
  'groceries',
  'home-decoration',
  'kitchen-accessories',
  'laptops',
  'mens-shirts',
  'mens-shoes',
  'mens-watches',
  'mobile-accessories',
  'motorcycle',
  'skin-care',
  'smartphones',
  'sports-accessories',
  'sunglasses',
  'tablets',
  'tops',
  'vehicle',
  'womens-bags',
  'womens-dresses',
  'womens-jewellery',
  'womens-shoes',
  'womens-watches',
] as const;

export const AVAILABILITY_STATUSES = ['In Stock', 'Low Stock', 'Out of Stock'] as const;

export const SHIPPING_INFORMATION_VALUES = [
  'Ships overnight',
  'Ships in 1-2 business days',
  'Ships in 3-5 business days',
  'Ships in 1 week',
  'Ships in 2 weeks',
  'Ships in 1 month',
] as const;

export const RETURN_POLICY_VALUES = [
  'No return policy',
  '7 days return policy',
  '30 days return policy',
  '60 days return policy',
  '90 days return policy',
] as const;

export const WARRANTY_INFORMATION_VALUES = [
  '1 week warranty',
  '1 month warranty',
  '3 months warranty',
  '6 months warranty',
  '1 year warranty',
  '2 year warranty',
  '3 year warranty',
  '5 year warranty',
  'Lifetime warranty',
  'No warranty',
] as const;

export const SORT_OPTIONS = [
  'relevance',
  'price-asc',
  'price-desc',
  'rating-desc',
  'discount-desc',
] as const;

export const rawProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  category: z.enum(CATEGORY_SLUGS),
  price: z.number(),
  discountPercentage: z.number(),
  rating: z.number(),
  stock: z.number(),
  tags: z.string().array(),
  brand: z.string().optional(),
  availabilityStatus: z.enum(AVAILABILITY_STATUSES),
  minimumOrderQuantity: z.number(),
  shippingInformation: z.enum(SHIPPING_INFORMATION_VALUES),
  returnPolicy: z.enum(RETURN_POLICY_VALUES),
  warrantyInformation: z.enum(WARRANTY_INFORMATION_VALUES),
  thumbnail: z.string(),
});

export const productCardSchema = z.object({
  id: z.number(),
  title: z.string(),
  shortDescription: z.string(),
  price: z.number(),
  discountPercentage: z.number(),
  effectivePrice: z.number(),
  rating: z.number(),
  thumbnail: z.string(),
  category: z.enum(CATEGORY_SLUGS),
  availabilityStatus: z.enum(AVAILABILITY_STATUSES),
  minimumOrderQuantity: z.number(),
  minimumSpend: z.number(),
});

export const retrievalCriteriaSchema = z.object({
  searchTerms: z.string().array(),
  categorySlug: z.enum(CATEGORY_SLUGS).optional(),
  maxPrice: z.number().optional(),
  minPrice: z.number().optional(),
  minRating: z.number().optional(),
  inStock: z.boolean().optional(),
  maxShippingDays: z.number().optional(),
  minReturnDays: z.number().optional(),
  sort: z.enum(SORT_OPTIONS).optional(),
  excludeBrands: z.string().array().optional(),
  excludeProductIds: z.number().array().optional(),
});

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type ShippingInformation = (typeof SHIPPING_INFORMATION_VALUES)[number];
export type ReturnPolicy = (typeof RETURN_POLICY_VALUES)[number];
export type WarrantyInformation = (typeof WARRANTY_INFORMATION_VALUES)[number];
export type SortOption = (typeof SORT_OPTIONS)[number];

export type RawProduct = z.infer<typeof rawProductSchema>;
export type ProductCard = z.infer<typeof productCardSchema>;
export type RetrievalCriteria = z.infer<typeof retrievalCriteriaSchema>;

// Deliberately a plain type, not a zod schema: 'Lifetime warranty' normalizes to
// Infinity, and zod 4's z.number() rejects non-finite values.
export type NormalizedProduct = RawProduct & {
  shippingDays: number;
  returnDays: number;
  warrantyMonths: number;
  effectivePrice: number;
  minimumSpend: number;
};
