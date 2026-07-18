import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';
import { mastra, SPIKE_AGENT_ID } from '@/mastra';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const params = await request.json();
  const { threadId, resourceId } = params;

  if (typeof threadId !== 'string' || typeof resourceId !== 'string') {
    return Response.json(
      {
        error: `threadId and resourceId are required (threadId: ${threadId}, resourceId: ${resourceId})`,
      },
      { status: 400 },
    );
  }

  const stream = await handleChatStream({
    mastra,
    agentId: SPIKE_AGENT_ID,
    version: 'v6',
    params: {
      ...params,
      memory: { thread: threadId, resource: resourceId },
    },
  });

  return createUIMessageStreamResponse({ stream });
}
