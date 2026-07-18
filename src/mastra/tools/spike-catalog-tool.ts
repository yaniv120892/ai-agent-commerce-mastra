import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const productSchema = z.object({
  id: z.number(),
  title: z.string(),
  price: z.number(),
  category: z.string(),
});

const spikeCatalog = [
  { id: 1, title: 'Essence Mascara Lash Princess', price: 9.99, category: 'beauty' },
  { id: 6, title: 'Calvin Klein CK One', price: 49.99, category: 'fragrances' },
  { id: 121, title: 'Apple MacBook Pro 14 Inch Space Grey', price: 1999.99, category: 'laptops' },
];

export const spikeCatalogTool = createTool({
  id: 'searchProducts',
  description:
    'Searches the product catalog. Returns a small list of products matching a free-text query.',
  inputSchema: z.object({
    query: z.string().describe('Free-text description of what the shopper is looking for'),
  }),
  outputSchema: z.object({
    query: z.string(),
    products: productSchema.array(),
  }),
  execute: async (inputData) => {
    return { query: inputData.query, products: spikeCatalog };
  },
});
