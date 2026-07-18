import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { getEnv } from '@/lib/env';
import { COMMERCE_AGENT_INSTRUCTIONS } from './instructions';
import { memory } from './memory';
import { resolveProductsTool } from './tools/resolve-products-tool';

export const COMMERCE_AGENT_ID = 'commerceAgent';

// The tools record key is the client discriminant: `resolveProducts` here produces
// message parts of type `tool-resolveProducts`, which the UI renders cards from.
export const commerceAgent = new Agent({
  id: COMMERCE_AGENT_ID,
  name: 'Commerce Copilot',
  instructions: COMMERCE_AGENT_INSTRUCTIONS,
  model: openai(getEnv().OPENAI_MODEL),
  tools: { resolveProducts: resolveProductsTool },
  memory,
});
