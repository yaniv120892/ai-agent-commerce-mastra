import { toAISdkMessages } from '@mastra/ai-sdk/ui';
import { getSpikeMemory } from '@/mastra';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const threadId = url.searchParams.get('threadId');
  const resourceId = url.searchParams.get('resourceId');

  if (!threadId || !resourceId) {
    return Response.json(
      {
        error: `threadId and resourceId query params are required (threadId: ${threadId}, resourceId: ${resourceId})`,
      },
      { status: 400 },
    );
  }

  const memory = getSpikeMemory();

  // recall() throws "No thread found with id" rather than returning an empty
  // result, so a first-visit thread has to be detected before recalling.
  const thread = await memory.getThreadById({ threadId, resourceId });
  if (!thread) {
    return Response.json({ messages: [] });
  }

  const { messages } = await memory.recall({ threadId, resourceId });

  return Response.json({ messages: toAISdkMessages(messages, { version: 'v6' }) });
}
