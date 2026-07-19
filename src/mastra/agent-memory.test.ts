import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { LibSQLStore } from '@mastra/libsql';
import type { MemoryConfig } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';
import { MockLanguageModelV4 } from 'ai/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog } from '@/catalog/__fixtures__/catalog';
import { resetCatalogCache } from '@/catalog/catalog-cache';
import { resolveProducts, resolveProductsWithTotals } from '@/catalog/resolve-products';
import { normalizeProduct } from '@/catalog/normalize';
import { retrievalCriteriaSchema, type RetrievalCriteria } from '@/catalog/types';
import { HISTORY_WINDOW_MESSAGES, shopperStateSchema } from './memory';
import { KnownToolsOnlyProcessor } from './processors/known-tools-only-processor';
import {
  resolveProductsOutputSchema,
  type ResolveProductsOutput,
} from './tools/resolve-products-tool.types';

type PromptMessage = MockLanguageModelV4['doGenerateCalls'][number]['prompt'][number];

type ToolReference = { kind: 'call' | 'result'; toolCallId: string; toolName: string };

const RESOURCE_ID = 'local-user';

// Every optional field the model is asked to emit, all null. OpenAI structured
// outputs require each declared property to be present, so this is the literal
// shape a real turn produces when the shopper stated no constraints.
const ALL_OPTIONALS_NULL = {
  searchTerms: ['mascara'],
  categorySlug: null,
  maxPrice: null,
  minPrice: null,
  minRating: null,
  inStock: null,
  maxShippingDays: null,
  minReturnDays: null,
  sort: null,
  excludeBrands: null,
  excludeProductIds: null,
};

const MOCK_USAGE: LanguageModelV4GenerateResult['usage'] = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const fetchMock = vi.fn<typeof fetch>();
const temporaryDirectories: string[] = [];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ products: fixtureCatalog }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  resetCatalogCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCatalogCache();
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function makeMemory(): Memory {
  return buildMemory({ lastMessages: HISTORY_WINDOW_MESSAGES });
}

function makeMemoryWithWorkingMemory(): Memory {
  return buildMemory({
    lastMessages: HISTORY_WINDOW_MESSAGES,
    workingMemory: { enabled: true, scope: 'thread', schema: shopperStateSchema },
  });
}

function buildMemory(options: MemoryConfig): Memory {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-'));
  temporaryDirectories.push(directory);

  return new Memory({
    storage: new LibSQLStore({
      id: 'test-store',
      url: `file:${path.join(directory, 'memory.db')}`,
    }),
    options,
  });
}

/**
 * Answers with a tool call on every odd model request and with prose on every even
 * one, which is the shape of a real turn: call the tool, then narrate the result.
 */
function makeModel(toolName: string, toolInput: unknown): MockLanguageModelV4 {
  let callIndex = 0;

  return new MockLanguageModelV4({
    modelId: 'mock-model',
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => {
      const isToolCall = callIndex % 2 === 0;
      callIndex += 1;

      if (isToolCall) {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: `${toolName}-${callIndex}`,
              toolName,
              input: JSON.stringify(toolInput),
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: MOCK_USAGE,
          warnings: [],
        };
      }

      return {
        content: [{ type: 'text' as const, text: 'Here are some options.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: MOCK_USAGE,
        warnings: [],
      };
    },
  });
}

function makeRecordingTool(recordedInputs: unknown[]) {
  return createTool({
    id: 'resolveProducts',
    description: 'Test double that records exactly what Mastra hands to execute.',
    inputSchema: retrievalCriteriaSchema,
    outputSchema: resolveProductsOutputSchema,
    execute: async (inputData): Promise<ResolveProductsOutput> => {
      recordedInputs.push(inputData);
      const result = resolveProductsWithTotals(inputData, fixtureCatalog.map(normalizeProduct));

      return { ...result, resultCount: result.products.length, criteria: inputData };
    },
  });
}

function makeAgent(
  memory: Memory,
  model: MockLanguageModelV4,
  toolKey: string,
  recordedInputs: unknown[],
): Agent {
  return new Agent({
    id: 'testAgent',
    name: 'Test Agent',
    instructions: 'Call the tool, then summarise.',
    model,
    tools: { [toolKey]: makeRecordingTool(recordedInputs) },
    memory,
    inputProcessors: [new KnownToolsOnlyProcessor(['resolveProducts'])],
  });
}

function toolReferences(prompt: PromptMessage[]): ToolReference[] {
  const references: ToolReference[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case 'assistant':
        for (const part of message.content) {
          if (part.type === 'tool-call') {
            references.push({
              kind: 'call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            });
          }
        }
        break;
      case 'tool':
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            references.push({
              kind: 'result',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
            });
          }
        }
        break;
      default:
        break;
    }
  }

  return references;
}

function lastPrompt(model: MockLanguageModelV4): PromptMessage[] {
  return model.doGenerateCalls[model.doGenerateCalls.length - 1].prompt;
}

/**
 * Guards the single most dangerous silent failure in the retrieval path.
 *
 * `retrievalCriteriaSchema` marks every constraint `.optional()`, and zod's
 * `.optional()` accepts `undefined` but rejects `null`. OpenAI structured outputs
 * require every declared property to be present, so the model emits `null` for each
 * constraint the shopper did not state. The two only fit together because Mastra
 * strips nulls before calling `execute`.
 *
 * If a Mastra upgrade stops stripping them, nothing throws where a human would see
 * it: `maxPrice: null` compares false against every price and retrieval returns an
 * empty list, so the agent politely reports that nothing matched. These tests turn
 * that into a red build instead.
 */
describe('null stripping between the model and tool execute', () => {
  it('is the behaviour the schema depends on: a null constraint fails validation', () => {
    expect(retrievalCriteriaSchema.safeParse(ALL_OPTIONALS_NULL).success).toBe(false);
    expect(
      retrievalCriteriaSchema.safeParse({ searchTerms: ['mascara'], maxPrice: undefined }).success,
    ).toBe(true);
  });

  it('would return nothing if a null price constraint ever reached resolveProducts', () => {
    const catalog = fixtureCatalog.map(normalizeProduct);
    const withoutConstraint: RetrievalCriteria = { searchTerms: ['mascara'] };
    // A null maxPrice is not merely ignored downstream: every comparison against it
    // is false, so the filter drops the entire catalog.
    const withNullConstraint = { searchTerms: ['mascara'], maxPrice: null };

    expect(resolveProducts(withoutConstraint, catalog).length).toBeGreaterThan(0);
    expect(
      resolveProducts(withNullConstraint as unknown as RetrievalCriteria, catalog),
    ).toHaveLength(0);
  });

  it('strips nulls before execute, so a model turn with no constraints still retrieves', async () => {
    const recordedInputs: unknown[] = [];
    const agent = makeAgent(
      makeMemory(),
      makeModel('resolveProducts', ALL_OPTIONALS_NULL),
      'resolveProducts',
      recordedInputs,
    );

    const result = await agent.generate('show me mascara', {
      memory: { thread: 'null-strip-thread', resource: RESOURCE_ID },
    });

    expect(recordedInputs).toHaveLength(1);
    const received = recordedInputs[0];
    if (typeof received !== 'object' || received === null) {
      throw new Error(
        `execute received a non-object input (received: ${JSON.stringify(received)})`,
      );
    }

    expect(received).toEqual({ searchTerms: ['mascara'] });
    for (const [field, value] of Object.entries(received)) {
      expect(value, `${field} reached execute as null`).not.toBeNull();
    }

    const toolResult = resolveProductsOutputSchema.parse(result.toolResults[0]?.payload.result);
    expect(toolResult.resultCount).toBeGreaterThan(0);
  }, 30_000);

  it('rejects the call outright if the stripped input is still schema-invalid', async () => {
    const recordedInputs: unknown[] = [];
    const agent = makeAgent(
      makeMemory(),
      makeModel('resolveProducts', { searchTerms: 'not-an-array' }),
      'resolveProducts',
      recordedInputs,
    );

    await agent.generate('show me mascara', {
      memory: { thread: 'invalid-input-thread', resource: RESOURCE_ID },
    });

    expect(recordedInputs).toHaveLength(0);
  }, 30_000);
});

describe('bounded history window', () => {
  it('keeps the prompt bounded as a thread grows', async () => {
    const memory = makeMemory();
    const model = makeModel('resolveProducts', ALL_OPTIONALS_NULL);
    const agent = makeAgent(memory, model, 'resolveProducts', []);

    for (let turn = 0; turn < 12; turn += 1) {
      await agent.generate(`turn ${turn}`, {
        memory: { thread: 'long-thread', resource: RESOURCE_ID },
      });
    }

    const recalledUserTurns = lastPrompt(model).filter((message) => message.role === 'user').length;

    expect(recalledUserTurns).toBeGreaterThan(1);
    expect(recalledUserTurns).toBeLessThanOrEqual(HISTORY_WINDOW_MESSAGES);
  }, 60_000);

  it('still answers on a long thread, and every recalled tool call keeps its result', async () => {
    const memory = makeMemory();
    const model = makeModel('resolveProducts', ALL_OPTIONALS_NULL);
    const agent = makeAgent(memory, model, 'resolveProducts', []);

    let lastText = '';
    for (let turn = 0; turn < 12; turn += 1) {
      const result = await agent.generate(`turn ${turn}`, {
        memory: { thread: 'long-thread', resource: RESOURCE_ID },
      });
      lastText = result.text;
    }

    expect(lastText).toBe('Here are some options.');

    // An assistant tool call whose result got cut off by the window is the classic
    // way a recalled prompt turns into an empty model turn.
    const references = toolReferences(lastPrompt(model));
    const answeredCallIds = new Set(
      references.filter((reference) => reference.kind === 'result').map((r) => r.toolCallId),
    );
    const unansweredCallIds = references
      .filter((reference) => reference.kind === 'call')
      .map((reference) => reference.toolCallId)
      .filter((toolCallId) => !answeredCallIds.has(toolCallId));

    expect(unansweredCallIds).toEqual([]);
  }, 60_000);
});

/**
 * Documents the eviction boundary that the two `*-survives-window-eviction` online
 * scenarios failed against, deterministically and without spending a token.
 *
 * The point of the second assertion is that this is NOT data loss. The constraint is
 * still in storage and still renders in the UI; it simply stops being handed to the
 * model. That is why a larger `lastMessages` only moves the cliff rather than removing
 * it, and why the fix is to hold shopper state outside the transcript.
 *
 * Working memory has since landed, so the two describes below are the two channels: the
 * transcript still evicts exactly as it always did — that fact is the reason the feature
 * exists, so it is asserted unchanged — while working memory carries the same constraint
 * past the same boundary. The window is still 20 in both.
 */
describe('constraints stated before the recall window, via the transcript', () => {
  const TURNS_THAT_FIT_THE_WINDOW = HISTORY_WINDOW_MESSAGES / 2;
  const SENTINEL = 'my budget is fifty dollars';

  it('stop reaching the model, while remaining in stored history', async () => {
    const memory = makeMemory();
    const model = makeModel('resolveProducts', ALL_OPTIONALS_NULL);
    const agent = makeAgent(memory, model, 'resolveProducts', []);

    await agent.generate(SENTINEL, {
      memory: { thread: 'eviction-thread', resource: RESOURCE_ID },
    });
    for (let turn = 0; turn <= TURNS_THAT_FIT_THE_WINDOW; turn += 1) {
      await agent.generate(`filler turn ${turn}`, {
        memory: { thread: 'eviction-thread', resource: RESOURCE_ID },
      });
    }

    expect(JSON.stringify(lastPrompt(model))).not.toContain(SENTINEL);

    const { messages } = await memory.recall({
      threadId: 'eviction-thread',
      resourceId: RESOURCE_ID,
    });
    expect(JSON.stringify(messages)).not.toContain(SENTINEL);

    const { messages: everyStoredMessage } = await memory.recall({
      threadId: 'eviction-thread',
      resourceId: RESOURCE_ID,
      threadConfig: { lastMessages: HISTORY_WINDOW_MESSAGES * 10 },
    });
    expect(JSON.stringify(everyStoredMessage)).toContain(SENTINEL);
  }, 60_000);
});

/**
 * The positive half: the same constraint, the same number of turns, the same window,
 * reaching the model anyway because working memory renders as a system message rather
 * than a conversational turn.
 *
 * `makeModel` is a mock that only ever emits the same `resolveProducts` call, so it will
 * never invoke `updateWorkingMemory` the way a real model does. State is written directly
 * instead — what is under test here is whether stored state survives eviction and reaches
 * the prompt, not whether a mock can be persuaded to call a tool.
 */
describe('constraints stated before the recall window, via working memory', () => {
  const TURNS_THAT_FIT_THE_WINDOW = HISTORY_WINDOW_MESSAGES / 2;
  const BUDGET_SENTINEL = 50;
  const SHOWN_ID_SENTINEL = 63;

  it('still reach the model after the transcript has evicted them', async () => {
    const memory = makeMemoryWithWorkingMemory();
    const model = makeModel('resolveProducts', ALL_OPTIONALS_NULL);
    const agent = makeAgent(memory, model, 'resolveProducts', []);

    await agent.generate('my budget is fifty dollars', {
      memory: { thread: 'working-memory-thread', resource: RESOURCE_ID },
    });
    await memory.updateWorkingMemory({
      threadId: 'working-memory-thread',
      resourceId: RESOURCE_ID,
      workingMemory: JSON.stringify({
        statedMaxPrice: BUDGET_SENTINEL,
        shownProductIds: [SHOWN_ID_SENTINEL],
        excludedBrands: [],
        categoryInterest: null,
      }),
    });

    for (let turn = 0; turn <= TURNS_THAT_FIT_THE_WINDOW; turn += 1) {
      await agent.generate(`filler turn ${turn}`, {
        memory: { thread: 'working-memory-thread', resource: RESOURCE_ID },
      });
    }

    const prompt = lastPrompt(model);
    const systemText = prompt
      .filter((message) => message.role === 'system')
      .map((message) => JSON.stringify(message.content))
      .join('\n');

    expect(JSON.stringify(prompt)).not.toContain('my budget is fifty dollars');
    expect(systemText).toContain(`\\"statedMaxPrice\\":${BUDGET_SENTINEL}`);
    expect(systemText).toContain(`\\"shownProductIds\\":[${SHOWN_ID_SENTINEL}]`);
  }, 60_000);
});

/**
 * The schema sits on the zod-4-hoisted / zod-3-vendored seam that
 * `src/lib/mastra-zod-interop.test.ts` pins for tools. Mastra converts it with
 * `~standard.jsonSchema.output(...)`, and a conversion that silently drops fields would
 * surface as an agent that quietly stops carrying a constraint rather than as a throw.
 */
describe('working memory schema conversion', () => {
  it('reaches Mastra as JSON carrying every shopper-state field', async () => {
    const template = await makeMemoryWithWorkingMemory().getWorkingMemoryTemplate({});

    expect(template?.format).toBe('json');

    const properties = Object.keys(JSON.parse(String(template?.content)).properties ?? {});
    expect(properties.sort()).toEqual(
      ['categoryInterest', 'excludedBrands', 'shownProductIds', 'statedMaxPrice'].sort(),
    );
  });
});

describe('history written by an earlier tool set', () => {
  it('never forwards a tool call the agent no longer declares', async () => {
    const memory = makeMemory();

    const retiredModel = makeModel('searchProducts', { searchTerms: ['mascara'] });
    const retiredAgent = makeAgent(memory, retiredModel, 'searchProducts', []);
    for (let turn = 0; turn < 2; turn += 1) {
      await retiredAgent.generate(`old turn ${turn}`, {
        memory: { thread: 'mixed-thread', resource: RESOURCE_ID },
      });
    }

    const currentModel = makeModel('resolveProducts', ALL_OPTIONALS_NULL);
    const currentAgent = makeAgent(memory, currentModel, 'resolveProducts', []);
    const result = await currentAgent.generate('and now something new', {
      memory: { thread: 'mixed-thread', resource: RESOURCE_ID },
    });

    const forwardedToolNames = toolReferences(currentModel.doGenerateCalls[0].prompt).map(
      (reference) => reference.toolName,
    );

    expect(forwardedToolNames).not.toContain('searchProducts');
    expect(result.text).toBe('Here are some options.');
  }, 60_000);

  it('leaves the retired turns in stored history so the UI can still render them', async () => {
    const memory = makeMemory();

    const retiredModel = makeModel('searchProducts', { searchTerms: ['mascara'] });
    const retiredAgent = makeAgent(memory, retiredModel, 'searchProducts', []);
    await retiredAgent.generate('old turn', {
      memory: { thread: 'preserved-thread', resource: RESOURCE_ID },
    });

    const { messages } = await memory.recall({
      threadId: 'preserved-thread',
      resourceId: RESOURCE_ID,
    });

    expect(JSON.stringify(messages)).toContain('searchProducts');
  }, 30_000);
});
