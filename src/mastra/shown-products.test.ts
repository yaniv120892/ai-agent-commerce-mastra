import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const temporaryDirectories: string[] = [];

function makeStorage(): LibSQLStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shown-products-'));
  temporaryDirectories.push(directory);

  return new LibSQLStore({
    id: 'shown-products-test-store',
    url: `file:${path.join(directory, 'memory.db')}`,
  });
}

const THREAD_ID = 'shown-products-thread';
const RESOURCE_ID = 'local-user';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('./memory');
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

/**
 * `recordShownProducts` reaches the module-level `commerceMemory`, so each case swaps that
 * module for a memory built to the shape under test.
 */
async function loadWithMemory(memory: Memory): Promise<{
  recordShownProducts: (input: {
    threadId: string;
    resourceId?: string;
    productIds: number[];
  }) => Promise<void>;
}> {
  vi.doMock('./memory', () => ({ commerceMemory: memory }));

  return import('./shown-products');
}

function memoryWithWorkingMemory(): Memory {
  return new Memory({
    storage: makeStorage(),
    options: {
      lastMessages: 20,
      workingMemory: {
        enabled: true,
        scope: 'thread',
        schema: z.object({
          statedMaxPrice: z.number().nullable(),
          shownProductIds: z.number().array(),
          excludedBrands: z.string().array(),
          categoryInterest: z.string().nullable(),
        }),
      },
    },
  });
}

describe('recording the products a search returned', () => {
  it('accumulates ids across searches instead of replacing them', async () => {
    const memory = memoryWithWorkingMemory();
    const { recordShownProducts } = await loadWithMemory(memory);
    await memory.createThread({ threadId: THREAD_ID, resourceId: RESOURCE_ID });

    await recordShownProducts({
      threadId: THREAD_ID,
      resourceId: RESOURCE_ID,
      productIds: [63, 73],
    });
    await recordShownProducts({
      threadId: THREAD_ID,
      resourceId: RESOURCE_ID,
      productIds: [66, 63],
    });

    const stored = await memory.getWorkingMemory({
      threadId: THREAD_ID,
      resourceId: RESOURCE_ID,
    });

    expect(JSON.parse(String(stored)).shownProductIds).toEqual([63, 73, 66]);
  }, 30_000);

  /**
   * The tool awaits this on the path that answers the shopper's search, so a memory that
   * cannot take the write must cost them a repeated page at worst — never the results.
   */
  it('stays silent when working memory is not enabled, rather than failing the search', async () => {
    const memory = new Memory({ storage: makeStorage(), options: { lastMessages: 20 } });
    const { recordShownProducts } = await loadWithMemory(memory);

    await expect(
      recordShownProducts({ threadId: THREAD_ID, resourceId: RESOURCE_ID, productIds: [63] }),
    ).resolves.toBeUndefined();
  }, 30_000);
});
