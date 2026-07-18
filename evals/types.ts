import { z } from 'zod';
import { CATEGORY_SLUGS, retrievalCriteriaSchema } from '@/catalog/types';

export const CRITERIA_FIELDS = [
  'searchTerms',
  'categorySlug',
  'maxPrice',
  'minPrice',
  'minRating',
  'inStock',
  'maxShippingDays',
  'minReturnDays',
  'sort',
  'excludeBrands',
  'excludeProductIds',
] as const;

const criteriaExpectationSchema = z.object({
  categorySlug: z.enum(CATEGORY_SLUGS).optional(),
  maxPriceAtMost: z.number().optional(),
  minPriceAtLeast: z.number().optional(),
  minRatingEquals: z.number().optional(),
  inStock: z.boolean().optional(),
  searchTermsIncludeAnyOf: z.string().array().optional(),
  searchTermsEmpty: z.boolean().optional(),
  excludeBrandsMatchAnyOf: z.string().array().optional(),
  excludesPreviouslyShownIds: z.boolean().optional(),
  requiredFields: z.enum(CRITERIA_FIELDS).array().optional(),
  forbiddenFields: z.enum(CRITERIA_FIELDS).array().optional(),
});

const scenarioExpectationSchema = z.object({
  toolCalled: z.boolean(),
  toolCallCount: z.number().optional(),
  criteria: criteriaExpectationSchema.optional(),
  criteriaPerCall: criteriaExpectationSchema.array().optional(),
  toolResults: z
    .object({
      totalProductsEquals: z.number().optional(),
      totalProductsAtLeast: z.number().optional(),
    })
    .optional(),
  forbidden: z.string().array().optional(),
  requiredAnyOf: z.string().array().optional(),
});

const offlineCallExpectationSchema = z.object({
  productIds: z.number().array().optional(),
  includesProductIds: z.number().array().optional(),
  excludesProductIds: z.number().array().optional(),
  subsetOfProductIds: z.number().array().optional(),
  nonEmpty: z.boolean().optional(),
  empty: z.boolean().optional(),
  everyPriceAtMost: z.number().optional(),
  everyRatingAtLeast: z.number().optional(),
  productFacts: z
    .object({
      id: z.number(),
      price: z.number().optional(),
      minimumOrderQuantity: z.number().optional(),
      minimumSpend: z.number().optional(),
    })
    .array()
    .optional(),
});

const offlineCallSchema = z.object({
  label: z.string(),
  criteria: retrievalCriteriaSchema,
  excludeIdsFromPreviousCall: z.boolean().optional(),
  expect: offlineCallExpectationSchema.optional(),
});

const offlineCheckSchema = z.object({
  note: z.string(),
  calls: offlineCallSchema.array().min(1),
  expect: z
    .object({
      callsDisjoint: z.boolean().optional(),
      laterCallReturnsFewer: z.boolean().optional(),
    })
    .optional(),
});

export const evalScenarioSchema = z.object({
  id: z.string(),
  query: z.string(),
  proves: z.string(),
  regressionOf: z.string().optional(),
  priorMessages: z.string().array().optional(),
  expect: scenarioExpectationSchema,
  offline: offlineCheckSchema.optional(),
  offlineGap: z.string().optional(),
});

export const evalScenarioFileSchema = z.object({
  $schema: z.string().optional(),
  scenarios: evalScenarioSchema.array().min(1),
});

export type CriteriaField = (typeof CRITERIA_FIELDS)[number];
export type CriteriaExpectation = z.infer<typeof criteriaExpectationSchema>;
export type ScenarioExpectation = z.infer<typeof scenarioExpectationSchema>;
export type OfflineCallExpectation = z.infer<typeof offlineCallExpectationSchema>;
export type OfflineCall = z.infer<typeof offlineCallSchema>;
export type OfflineCheck = z.infer<typeof offlineCheckSchema>;
export type EvalScenario = z.infer<typeof evalScenarioSchema>;
