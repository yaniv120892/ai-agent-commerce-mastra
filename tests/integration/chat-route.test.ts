import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import fs from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureCatalog } from '@/catalog/__fixtures__/catalog';
import { resetCatalogCache } from '@/catalog/catalog-cache';

/**
 * Integration coverage for `/api/chat` across the route, the Mastra agent, a real
 * LibSQL memory store and the real `resolveProducts` tool. Exactly two things are
 * doubled: the language model (a `MockLanguageModelV4`, so no OpenAI request is ever
 * made) and the catalog HTTP fetch.
 *
 * The file sits under tests/unit because that is the only `tests/**` glob in
 * vitest.config.ts, which this ticket may not edit.
 */

const TOOL_NAME = 'resolveProducts';
const SMARTPHONE_PROMPT = 'I need a smartphone under $400';
const SMARTPHONE_CRITERIA = { searchTerms: ['smartphone', 'phone'], maxPrice: 400 };
const LAPTOP_CRITERIA = { searchTerms: ['laptop'] };

const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const harness = vi.hoisted(async () => {
  process.env.OPENAI_API_KEY ??= 'chat-route-integration-test-key';

  const nodeFs = await import('node:fs');
  const nodeOs = await import('node:os');
  const nodePath = await import('node:path');
  const { LibSQLStore } = await import('@mastra/libsql');
  const { Memory } = await import('@mastra/memory');
  const { MockLanguageModelV4 } = await import('ai/test');
  const { simulateReadableStream } = await import('ai');

  const directory = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'chat-route-'));
  const storage = new LibSQLStore({
    id: 'chat-route-test-store',
    url: `file:${nodePath.join(directory, 'memory.db')}`,
  });

  let modelTurns: LanguageModelV4StreamPart[][] = [];
  let turnIndex = 0;

  const model = new MockLanguageModelV4({
    modelId: 'mock-model',
    doStream: async () => {
      const chunks = modelTurns[turnIndex] ?? modelTurns[modelTurns.length - 1] ?? [];
      turnIndex += 1;

      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 0 }) };
    },
  });

  return {
    directory,
    storage,
    memory: new Memory({ storage, options: { lastMessages: 20 } }),
    model,
    setModelTurns: (turns: LanguageModelV4StreamPart[][]): void => {
      modelTurns = turns;
      turnIndex = 0;
    },
  };
});

vi.mock('@/mastra/memory', async () => {
  const { memory, storage } = await harness;

  return { commerceMemory: memory, storage, HISTORY_WINDOW_MESSAGES: 20 };
});

vi.mock('@ai-sdk/openai', async () => {
  const { model } = await harness;

  return { openai: () => model };
});

const { directory: harnessDirectory, model: mockModel, setModelTurns } = await harness;
const chatRoute = await import('@/app/api/chat/route');
const conversationsRoute = await import('@/app/api/conversations/route');

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => catalogResponse());
  vi.stubGlobal('fetch', fetchMock);
  resetCatalogCache();
  mockModel.doStreamCalls.length = 0;
  setModelTurns([toolCallTurn(SMARTPHONE_CRITERIA), proseTurn('Here are some options.')]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCatalogCache();
});

afterAll(() => {
  fs.rmSync(harnessDirectory, { recursive: true, force: true });
});

describe('POST /api/chat with a stubbed model', () => {
  it('streams a resolveProducts tool result whose output carries product cards', async () => {
    const threadId = await createConversation();

    const chunks = await postTurn(threadId, SMARTPHONE_PROMPT);

    expect(findChunk(chunks, 'tool-input-start').toolName).toBe(TOOL_NAME);

    const output = findChunk(chunks, 'tool-output-available').output;
    if (!isToolOutput(output)) {
      throw new Error(`tool-output-available carried no products: ${JSON.stringify(output)}`);
    }

    expect(output.products.length).toBeGreaterThan(0);
    expect(output.resultCount).toBe(output.products.length);
    for (const product of output.products) {
      expect(product.price).toBeLessThanOrEqual(400);
      expect(product.title.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it('makes no OpenAI request: the only outbound call is the catalog fetch', async () => {
    const threadId = await createConversation();

    await postTurn(threadId, SMARTPHONE_PROMPT);

    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls.some((url) => url.includes('api.openai.com'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('dummyjson.com'))).toBe(true);
  }, 30_000);

  it('rejects a thread that was never created, so chat cannot outrun conversation creation', async () => {
    const response = await chatRoute.POST(chatRequest('missing-thread', 'hello'));

    expect(response.status).toBe(404);
    await expect(readError(response)).resolves.toContain('missing-thread');
  });

  it('rejects a request that carries no threadId', async () => {
    const response = await chatRoute.POST(
      jsonRequest('http://localhost/api/chat', { messages: [] }),
    );

    expect(response.status).toBe(400);
    await expect(readError(response)).resolves.toContain('threadId is required');
  });
});

describe('the turn is durable once the stream completes', () => {
  it('replays the tool part from history as tool-resolveProducts with populated output', async () => {
    const threadId = await createConversation();
    await postTurn(threadId, SMARTPHONE_PROMPT);

    const toolParts = (await getHistory(threadId)).flatMap((message) =>
      message.parts.filter((part) => part.type === `tool-${TOOL_NAME}`),
    );

    expect(toolParts.length).toBeGreaterThan(0);
    expect(toolParts[0].state).toBe('output-available');
    if (!isToolOutput(toolParts[0].output)) {
      throw new Error(`recalled tool part carried no products: ${JSON.stringify(toolParts[0])}`);
    }
    expect(toolParts[0].output.products.length).toBeGreaterThan(0);
  }, 30_000);

  it('backfills an untitled conversation from the first user message', async () => {
    const threadId = await createConversation();
    expect(await readConversationTitle(threadId)).toBeNull();

    await postTurn(threadId, SMARTPHONE_PROMPT);

    expect(await readConversationTitle(threadId)).toBe(SMARTPHONE_PROMPT);
  }, 30_000);
});

describe('multi-turn threads', () => {
  it('keeps both turns, in order, on one thread', async () => {
    const threadId = await createConversation();

    setModelTurns([
      toolCallTurn(SMARTPHONE_CRITERIA),
      proseTurn('Here are some phones.'),
      toolCallTurn(LAPTOP_CRITERIA),
      proseTurn('And here are some laptops.'),
    ]);

    await postTurn(threadId, SMARTPHONE_PROMPT);
    await postTurn(threadId, 'now show me a laptop');

    await expect(readTexts(threadId, 'user')).resolves.toEqual([
      SMARTPHONE_PROMPT,
      'now show me a laptop',
    ]);
    await expect(readTexts(threadId, 'assistant')).resolves.toEqual([
      'Here are some phones.',
      'And here are some laptops.',
    ]);
  }, 60_000);

  it('replays the earlier turn to the model as context on the second turn', async () => {
    const threadId = await createConversation();

    await postTurn(threadId, SMARTPHONE_PROMPT);
    setModelTurns([toolCallTurn(LAPTOP_CRITERIA), proseTurn('Laptops next.')]);
    await postTurn(threadId, 'now show me a laptop');

    const finalPrompt = JSON.stringify(mockModel.doStreamCalls[mockModel.doStreamCalls.length - 1]);

    expect(finalPrompt).toContain(SMARTPHONE_PROMPT);
    expect(finalPrompt).toContain('now show me a laptop');
  }, 60_000);
});

describe('concurrent threads', () => {
  it('keeps two conversations isolated when their turns interleave', async () => {
    const firstThreadId = await createConversation();
    const secondThreadId = await createConversation();

    await postTurn(firstThreadId, SMARTPHONE_PROMPT);
    setModelTurns([toolCallTurn(LAPTOP_CRITERIA), proseTurn('Laptops next.')]);
    await postTurn(secondThreadId, 'I need a laptop');

    await expect(readTexts(firstThreadId, 'user')).resolves.toEqual([SMARTPHONE_PROMPT]);
    await expect(readTexts(secondThreadId, 'user')).resolves.toEqual(['I need a laptop']);
  }, 60_000);

  it('lists every conversation created so far', async () => {
    const firstThreadId = await createConversation();
    const secondThreadId = await createConversation();

    const response = await conversationsRoute.GET();
    const ids = readArray(await response.json(), 'conversations').map((conversation) =>
      readString(asRecord(conversation), 'id'),
    );

    expect(ids).toContain(firstThreadId);
    expect(ids).toContain(secondThreadId);
  });
});

describe('error surfaces', () => {
  it('reports a catalog failure as an output-error part rather than an empty grid', async () => {
    const threadId = await createConversation();
    fetchMock.mockImplementation(async () => new Response('upstream exploded', { status: 500 }));

    const chunks = await postTurn(threadId, SMARTPHONE_PROMPT);
    const errorChunk = findChunk(chunks, 'tool-output-error');

    expect(String(errorChunk.errorText)).toContain('dummyjson.com');
  }, 30_000);

  it('serializes a mid-stream model failure as an error part instead of a silent stop', async () => {
    const threadId = await createConversation();
    setModelTurns([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'error', error: new Error('the model exploded mid-stream') },
        { type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage: MOCK_USAGE },
      ],
    ]);

    const chunks = await postTurn(threadId, SMARTPHONE_PROMPT);
    const errorChunk = findChunk(chunks, 'error');

    expect(String(errorChunk.errorText)).toContain('could not finish this reply');
  }, 30_000);
});

type StreamChunk = {
  type: string;
  toolName: string | undefined;
  output: unknown;
  errorText: string | undefined;
};

type HistoryPart = {
  type: string;
  state: string | undefined;
  output: unknown;
  text: string | undefined;
};

type HistoryMessage = {
  role: string;
  parts: HistoryPart[];
};

type ToolOutput = {
  products: { title: string; price: number }[];
  resultCount: number;
};

function catalogResponse(): Response {
  return new Response(JSON.stringify({ products: fixtureCatalog }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function toolCallTurn(input: unknown): LanguageModelV4StreamPart[] {
  const toolCallId = `call-${Math.random().toString(36).slice(2)}`;
  const serializedInput = JSON.stringify(input);

  return [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-input-start', id: toolCallId, toolName: TOOL_NAME },
    { type: 'tool-input-delta', id: toolCallId, delta: serializedInput },
    { type: 'tool-input-end', id: toolCallId },
    { type: 'tool-call', toolCallId, toolName: TOOL_NAME, input: serializedInput },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: MOCK_USAGE,
    },
  ];
}

function proseTurn(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: text },
    { type: 'text-end', id: 'text-1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: MOCK_USAGE },
  ];
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createConversation(): Promise<string> {
  const response = await conversationsRoute.POST(
    jsonRequest('http://localhost/api/conversations', {}),
  );

  expect(response.status).toBe(201);

  const body = asRecord(await response.json());

  return readString(asRecord(body.conversation), 'id');
}

function chatRequest(threadId: string, text: string): Request {
  return jsonRequest('http://localhost/api/chat', {
    threadId,
    messages: [{ id: `user-${text.length}`, role: 'user', parts: [{ type: 'text', text }] }],
  });
}

async function postTurn(threadId: string, text: string): Promise<StreamChunk[]> {
  const response = await chatRoute.POST(chatRequest(threadId, text));

  expect(response.status, `POST /api/chat failed: ${await describeFailure(response)}`).toBe(200);

  return readStreamChunks(await response.text());
}

async function describeFailure(response: Response): Promise<string> {
  if (response.ok) {
    return '';
  }

  return await response.clone().text();
}

function readStreamChunks(body: string): StreamChunk[] {
  const chunks: StreamChunk[] = [];

  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue;
    }

    const payload = line.slice('data: '.length).trim();
    if (payload.length === 0 || payload === '[DONE]') {
      continue;
    }

    const record = asRecord(JSON.parse(payload));
    chunks.push({
      type: readString(record, 'type'),
      toolName: optionalString(record, 'toolName'),
      output: record.output,
      errorText: optionalString(record, 'errorText'),
    });
  }

  return chunks;
}

function findChunk(chunks: StreamChunk[], type: string): StreamChunk {
  const chunk = chunks.find((candidate) => candidate.type === type);
  if (!chunk) {
    throw new Error(
      `No ${type} chunk in the stream (received: ${JSON.stringify(chunks.map((candidate) => candidate.type))})`,
    );
  }

  return chunk;
}

async function getHistory(threadId: string): Promise<HistoryMessage[]> {
  const response = await chatRoute.GET(
    new Request(`http://localhost/api/chat?threadId=${encodeURIComponent(threadId)}`),
  );

  expect(response.status, `GET /api/chat failed: ${await describeFailure(response)}`).toBe(200);

  return readArray(await response.json(), 'messages').map((message) => {
    const record = asRecord(message);

    return { role: readString(record, 'role'), parts: readParts(record.parts) };
  });
}

function readParts(value: unknown): HistoryPart[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((part) => {
    const record = asRecord(part);

    return {
      type: readString(record, 'type'),
      state: optionalString(record, 'state'),
      output: record.output,
      text: optionalString(record, 'text'),
    };
  });
}

async function readTexts(threadId: string, role: string): Promise<string[]> {
  return (await getHistory(threadId))
    .filter((message) => message.role === role)
    .map((message) =>
      message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
        .trim(),
    )
    .filter((text) => text.length > 0);
}

async function readConversationTitle(threadId: string): Promise<string | null> {
  const response = await conversationsRoute.GET();
  const conversation = readArray(await response.json(), 'conversations').find(
    (candidate) => asRecord(candidate).id === threadId,
  );

  if (conversation === undefined) {
    throw new Error(`GET /api/conversations did not list thread ${threadId}`);
  }

  return optionalString(asRecord(conversation), 'title') ?? null;
}

async function readError(response: Response): Promise<string> {
  return readString(asRecord(await response.json()), 'error');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected an object, received: ${JSON.stringify(value)}`);
  }

  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }

  return record;
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(`Expected ${field} to be a string, received: ${JSON.stringify(value)}`);
  }

  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];

  return typeof value === 'string' ? value : undefined;
}

function readArray(body: unknown, field: string): unknown[] {
  const value = asRecord(body)[field];
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${field} to be an array, received: ${JSON.stringify(value)}`);
  }

  return value;
}

function isToolOutput(value: unknown): value is ToolOutput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = asRecord(value);

  return Array.isArray(record.products) && typeof record.resultCount === 'number';
}
