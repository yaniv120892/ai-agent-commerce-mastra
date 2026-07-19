import { z } from 'zod';
import {
  CATEGORY_SLUGS,
  SORT_OPTIONS,
  productCardSchema,
  retrievalCriteriaSchema,
} from '@/catalog/types';

// The two enum fields are explicitly nullable while every other optional field is not, and
// that asymmetry is load-bearing. OpenAI's strict function-calling transform moves every
// property into `required` and expresses optionality by ANDing on `anyOf: [T, null]`. For
// an enum it leaves the original non-nullable `enum` keyword as a sibling of that `anyOf`,
// so the two intersect and `null` satisfies neither branch — while the field is required.
// The result is a grammar in which omitting categorySlug is unrepresentable, and the model
// is forced to invent a category on every call no matter what the system prompt says.
// Declaring the enums nullable leaves no sibling `enum` for the transform to collide with.
export const resolveProductsInputSchema = retrievalCriteriaSchema.extend({
  categorySlug: z.enum(CATEGORY_SLUGS).nullable().optional(),
  sort: z.enum(SORT_OPTIONS).nullable().optional(),
});

export const resolveProductsOutputSchema = z.object({
  products: productCardSchema.array(),
  resultCount: z.number(),
  criteria: retrievalCriteriaSchema,
  totalMatched: z.number(),
  remainingAfterThisPage: z.number(),
  totalMatchedWithoutCategoryFilter: z.number().optional(),
  totalInCategory: z.number().optional(),
});

export type ResolveProductsInput = z.infer<typeof resolveProductsInputSchema>;
export type ResolveProductsOutput = z.infer<typeof resolveProductsOutputSchema>;
