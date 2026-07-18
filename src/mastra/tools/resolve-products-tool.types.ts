import { z } from 'zod';
import { productCardSchema, retrievalCriteriaSchema } from '@/catalog/types';

export const resolveProductsOutputSchema = z.object({
  products: productCardSchema.array(),
  resultCount: z.number(),
  criteria: retrievalCriteriaSchema,
});

export type ResolveProductsOutput = z.infer<typeof resolveProductsOutputSchema>;
