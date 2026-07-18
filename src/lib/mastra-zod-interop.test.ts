import { createTool, noopObserve } from '@mastra/core/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * npm install reports an ERESOLVE peer warning: @mastra/core vendors a nested
 * @ai-sdk/ui-utils-v5 that peer-requires zod ^3.23.8, while this project hoists
 * zod 4.4.3. These tests pin down that the combination actually works, so a
 * regression surfaces here rather than as a malformed tool schema at runtime.
 */
describe('Mastra + zod 4 interop', () => {
  const inputSchema = z.object({
    query: z.string().min(1),
    maxPrice: z.number().positive().optional(),
  });

  const searchTool = createTool({
    id: 'search-products',
    description: 'Search the catalog',
    inputSchema,
    outputSchema: z.object({
      matchCount: z.number(),
    }),
    execute: async (inputData) => {
      return { matchCount: inputData.query.length };
    },
  });

  it('builds a tool from zod 4 schemas', () => {
    expect(searchTool.id).toBe('search-products');
    expect(searchTool.inputSchema).toBeDefined();
  });

  it('accepts input that satisfies the zod 4 schema', () => {
    expect(inputSchema.safeParse({ query: 'blue shoes', maxPrice: 50 }).success).toBe(true);
  });

  it('rejects input that violates the zod 4 schema', () => {
    expect(inputSchema.safeParse({ query: '', maxPrice: -1 }).success).toBe(false);
  });

  it('executes with input as the first positional argument', async () => {
    const result = await searchTool.execute!({ query: 'shoes' }, { observe: noopObserve });

    expect(result).toEqual({ matchCount: 5 });
  });
});
