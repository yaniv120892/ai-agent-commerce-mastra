import { Mastra } from '@mastra/core';
import type { Memory } from '@mastra/memory';
import { COMMERCE_AGENT_ID, commerceAgent } from './agent';
import { commerceMemory, storage } from './memory';

export const mastra = new Mastra({
  agents: { [COMMERCE_AGENT_ID]: commerceAgent },
  storage,
});

export { COMMERCE_AGENT_ID, commerceAgent };

export function getCommerceMemory(): Memory {
  return commerceMemory;
}
