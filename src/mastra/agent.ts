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

// Not exported by @mastra/memory, but enabling working memory registers a tool under this
// exact name. It is absent from COMMERCE_TOOLS because the agent never declares it, so
// KnownToolsOnlyProcessor would strip the call the model just made from its own next step —
// the model would see no evidence it stored anything and re-call until the step budget ran out.
const WORKING_MEMORY_TOOL_NAME = 'updateWorkingMemory';

export const commerceAgent = new Agent({
  id: COMMERCE_AGENT_ID,
  name: 'Commerce Copilot',
  instructions: COMMERCE_AGENT_INSTRUCTIONS,
  model: openai(getEnv().OPENAI_MODEL),
  tools: COMMERCE_TOOLS,
  memory: commerceMemory,
  inputProcessors: [
    new KnownToolsOnlyProcessor([...Object.keys(COMMERCE_TOOLS), WORKING_MEMORY_TOOL_NAME]),
  ],
});
