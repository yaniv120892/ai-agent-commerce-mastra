import type { StorageThreadType } from '@mastra/core/memory';
import { randomUUID } from 'node:crypto';
import { deriveConversationTitle, LOCAL_RESOURCE_ID } from '@/lib/conversation';
import { getCommerceMemory } from '@/mastra';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { threads } = await getCommerceMemory().listThreads({
      filter: { resourceId: LOCAL_RESOURCE_ID },
      orderBy: { field: 'updatedAt', direction: 'DESC' },
    });

    return Response.json({
      conversations: threads.map((thread) => toConversation(thread)),
    });
  } catch (error) {
    return Response.json(
      { error: `Could not list conversations: ${describeError(error)}` },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const requestedTitle = Reflect.get(body, 'title');
  const firstMessage = Reflect.get(body, 'firstMessage');

  try {
    const thread = await getCommerceMemory().createThread({
      threadId: randomUUID(),
      resourceId: LOCAL_RESOURCE_ID,
      title: resolveTitle(requestedTitle, firstMessage),
    });

    return Response.json({ conversation: toConversation(thread) }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: `Could not create a conversation: ${describeError(error)}` },
      { status: 500 },
    );
  }
}

// Mastra stores an absent title as an empty string; the UI needs a single "no title
// yet" signal so it can show a placeholder rather than a blank row.
function toConversation(thread: StorageThreadType) {
  return {
    id: thread.id,
    title: thread.title && thread.title.trim().length > 0 ? thread.title : null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

// A title is optional at creation time: the UI can open an empty conversation and let
// POST /api/chat backfill the title from the first message the shopper actually sends.
function resolveTitle(requestedTitle: unknown, firstMessage: unknown): string | undefined {
  if (typeof requestedTitle === 'string' && requestedTitle.trim().length > 0) {
    return deriveConversationTitle(requestedTitle);
  }
  if (typeof firstMessage === 'string' && firstMessage.trim().length > 0) {
    return deriveConversationTitle(firstMessage);
  }

  return undefined;
}

async function readJsonBody(request: Request): Promise<object> {
  try {
    const body: unknown = await request.json();
    if (typeof body === 'object' && body !== null) {
      return body;
    }
  } catch {
    // An absent or unparseable body is a valid "create an untitled conversation".
  }

  return {};
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
