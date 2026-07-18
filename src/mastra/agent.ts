import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { getEnv } from '@/lib/env';
import { COMMERCE_AGENT_INSTRUCTIONS } from './instructions';
import { commerceMemory } from './memory';
import { KnownToolsOnlyProcessor } from './processors/known-tools-only-processor';
import { resolveProductsTool } from './tools/resolve-products-tool';

export const COMMERCE_AGENT_ID = 'commerceAgent';

// The tools record key is the client discriminant: `resolveProducts` here produces
// message parts of type `tool-resolveProducts`, which the UI renders cards from.
export const COMMERCE_TOOLS = { resolveProducts: resolveProductsTool };

export const commerceAgent = new Agent({
  id: COMMERCE_AGENT_ID,
  name: 'Commerce Copilot',
  instructions: COMMERCE_AGENT_INSTRUCTIONS,
  model: openai(getEnv().OPENAI_MODEL),
  tools: COMMERCE_TOOLS,
  memory: commerceMemory,
  inputProcessors: [new KnownToolsOnlyProcessor(Object.keys(COMMERCE_TOOLS))],
});
