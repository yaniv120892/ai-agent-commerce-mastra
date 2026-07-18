import { handleChatStream } from '@mastra/ai-sdk';
import { toAISdkMessages } from '@mastra/ai-sdk/ui';
import { createUIMessageStreamResponse } from 'ai';
import { deriveConversationTitle, LOCAL_RESOURCE_ID } from '@/lib/conversation';
import { COMMERCE_AGENT_ID, getCommerceMemory, mastra } from '@/mastra';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  // Kept untyped: handleChatStream's v6 overload only resolves against the raw
  // request body shape, and narrowing it here silently selects the v5 overload.
  let params;
  try {
    params = await request.json();
  } catch (error) {
    return Response.json(
      { error: `Request body must be valid JSON: ${describeError(error)}` },
      { status: 400 },
    );
  }

  const threadId = params?.threadId;

  if (typeof threadId !== 'string' || threadId.length === 0) {
    return Response.json(
      { error: `threadId is required and must be a non-empty string (threadId: ${threadId})` },
      { status: 400 },
    );
  }

  const memory = getCommerceMemory();

  try {
    const thread = await memory.getThreadById({ threadId, resourceId: LOCAL_RESOURCE_ID });
    if (!thread) {
      return Response.json(
        { error: `Conversation not found (threadId: ${threadId})` },
        { status: 404 },
      );
    }

    await backfillTitle(memory, thread, params?.messages);

    const stream = await handleChatStream({
      mastra,
      agentId: COMMERCE_AGENT_ID,
      version: 'v6',
      params: {
        ...params,
        memory: { thread: threadId, resource: LOCAL_RESOURCE_ID },
      },
      // A failure once the stream is open can no longer become an HTTP status, so it
      // reaches the user as an error part instead of a turn that just stops.
      onError: (error) => `The assistant could not finish this reply: ${describeError(error)}`,
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return Response.json(
      { error: `Could not start this reply (threadId: ${threadId}): ${describeError(error)}` },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get('threadId');

  if (!threadId) {
    return Response.json(
      { error: `threadId query param is required (threadId: ${threadId})` },
      { status: 400 },
    );
  }

  const memory = getCommerceMemory();

  try {
    // recall() throws "No thread found with id" rather than returning an empty
    // result, so an unknown thread has to be detected before recalling.
    const thread = await memory.getThreadById({ threadId, resourceId: LOCAL_RESOURCE_ID });
    if (!thread) {
      return Response.json(
        { error: `Conversation not found (threadId: ${threadId})`, messages: [] },
        { status: 404 },
      );
    }

    const { messages } = await memory.recall({ threadId, resourceId: LOCAL_RESOURCE_ID });

    return Response.json({ messages: toAISdkMessages(messages, { version: 'v6' }) });
  } catch (error) {
    return Response.json(
      {
        error: `Could not load this conversation (threadId: ${threadId}): ${describeError(error)}`,
      },
      { status: 500 },
    );
  }
}

type CommerceMemory = ReturnType<typeof getCommerceMemory>;
type CommerceThread = Awaited<ReturnType<CommerceMemory['getThreadById']>>;

async function backfillTitle(
  memory: CommerceMemory,
  thread: CommerceThread,
  messages: unknown,
): Promise<void> {
  if (!thread || thread.title) {
    return;
  }

  const latestUserText = readLatestUserText(messages);
  if (!latestUserText) {
    return;
  }

  await memory.saveThread({
    thread: { ...thread, title: deriveConversationTitle(latestUserText) },
  });
}

function readLatestUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message: unknown = messages[index];
    if (typeof message !== 'object' || message === null) {
      continue;
    }
    if (Reflect.get(message, 'role') !== 'user') {
      continue;
    }

    const parts: unknown = Reflect.get(message, 'parts');
    if (!Array.isArray(parts)) {
      continue;
    }

    const text = parts
      .filter((part) => isTextPart(part))
      .map((part) => part.text)
      .join(' ');
    if (text.trim().length > 0) {
      return text;
    }
  }

  return null;
}

function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  if (typeof part !== 'object' || part === null) {
    return false;
  }

  return Reflect.get(part, 'type') === 'text' && typeof Reflect.get(part, 'text') === 'string';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
