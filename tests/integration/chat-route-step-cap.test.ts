import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_RESOURCE_ID } from '@/lib/conversation';

process.env.OPENAI_API_KEY ??= 'chat-route-step-cap-test-key';

type StreamOptions = { params?: unknown };

const handleChatStreamMock = vi.fn<(options: StreamOptions) => Promise<ReadableStream>>(
  async () => new ReadableStream(),
);

const harness = (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-route-step-cap-'));
  const storage = new LibSQLStore({
    id: 'step-cap-store',
    url: `file:${path.join(directory, 'memory.db')}`,
  });

  return { directory, storage, memory: new Memory({ storage, options: { lastMessages: 20 } }) };
})();

vi.mock('@mastra/ai-sdk', () => ({
  handleChatStream: (options: StreamOptions) => handleChatStreamMock(options),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();

  return { ...actual, createUIMessageStreamResponse: () => new Response('stream') };
});

vi.mock('@/mastra/memory', async () => {
  const { memory, storage } = await harness;

  return { commerceMemory: memory, storage, HISTORY_WINDOW_MESSAGES: 20 };
});

const { directory: harnessDirectory, memory } = await harness;
const chatRoute = await import('@/app/api/chat/route');

async function createThread(): Promise<string> {
  const threadId = crypto.randomUUID();
  await memory.createThread({ threadId, resourceId: LOCAL_RESOURCE_ID, title: 'Step cap' });

  return threadId;
}

function chatRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsFromLastCall(): Record<string, unknown> {
  const lastCall = handleChatStreamMock.mock.calls.at(-1);
  if (!lastCall) {
    throw new Error('handleChatStream was never called');
  }
  const { params } = lastCall[0];
  if (typeof params !== 'object' || params === null) {
    throw new Error(`handleChatStream received a non-object params (params: ${String(params)})`);
  }

  return Object.fromEntries(Object.entries(params));
}

beforeEach(() => {
  handleChatStreamMock.mockClear();
});

afterAll(() => {
  fs.rmSync(harnessDirectory, { recursive: true, force: true });
});

describe('POST /api/chat step budget', () => {
  it('bounds every turn so a tool loop cannot bill indefinitely', async () => {
    const threadId = await createThread();

    await chatRoute.POST(chatRequest({ threadId, messages: [] }));

    expect(paramsFromLastCall().maxSteps).toBe(chatRoute.MAX_STEPS_PER_TURN);
  });

  it('ignores a maxSteps sent by the client rather than letting it raise the ceiling', async () => {
    const threadId = await createThread();

    await chatRoute.POST(chatRequest({ threadId, messages: [], maxSteps: 999 }));

    expect(paramsFromLastCall().maxSteps).toBe(chatRoute.MAX_STEPS_PER_TURN);
  });

  it('keeps thread and resource scoping server-controlled alongside it', async () => {
    const threadId = await createThread();

    await chatRoute.POST(
      chatRequest({ threadId, messages: [], memory: { thread: 'attacker', resource: 'attacker' } }),
    );

    expect(paramsFromLastCall().memory).toEqual({
      thread: threadId,
      resource: LOCAL_RESOURCE_ID,
    });
  });
});
