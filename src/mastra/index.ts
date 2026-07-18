import { openai } from '@ai-sdk/openai';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { getEnv } from '@/lib/env';
import { COMMERCE_AGENT_ID, commerceAgent } from './agent';
import { memory, storage } from './memory';
import { spikeCatalogTool } from './tools/spike-catalog-tool';

export const SPIKE_AGENT_ID = 'spikeAgent';

const spikeAgent = new Agent({
  id: SPIKE_AGENT_ID,
  name: 'Spike Agent',
  instructions:
    'You are a shopping assistant. Whenever the user asks about products, you MUST call the searchProducts tool before answering. Keep prose answers to one short sentence; the UI renders the product cards from the tool result.',
  model: openai(getEnv().OPENAI_MODEL),
  tools: { searchProducts: spikeCatalogTool },
  memory,
});

export const mastra = new Mastra({
  agents: { [SPIKE_AGENT_ID]: spikeAgent, [COMMERCE_AGENT_ID]: commerceAgent },
  storage,
});

export { COMMERCE_AGENT_ID, commerceAgent };

export function getSpikeMemory(): Memory {
  return memory;
}
