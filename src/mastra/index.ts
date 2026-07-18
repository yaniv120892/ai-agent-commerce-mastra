import { openai } from '@ai-sdk/openai';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import path from 'node:path';
import { getEnv } from '@/lib/env';
import { spikeCatalogTool } from './tools/spike-catalog-tool';

export const SPIKE_AGENT_ID = 'spikeAgent';

const storage = new LibSQLStore({
  id: 'spike-store',
  url: `file:${path.join(process.cwd(), 'spike-memory.db')}`,
});

const memory = new Memory({ storage });

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
  agents: { [SPIKE_AGENT_ID]: spikeAgent },
  storage,
});

export function getSpikeMemory(): Memory {
  return memory;
}
