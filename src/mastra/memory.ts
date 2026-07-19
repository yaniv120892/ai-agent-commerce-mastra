import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import path from 'node:path';
import { z } from 'zod';
import { ensureUsableDatabaseFile } from './database-file';

export const MEMORY_DATABASE_PATH = path.join(process.cwd(), 'commerce-memory.db');

// Recall is bounded so a long conversation cannot grow the prompt without limit.
// Mastra's own default is 10, but leaving it implicit means a library upgrade can
// move the window silently; stating it keeps the number reviewable next to the cost
// it implies. Twenty stored messages is roughly ten shopper turns, and a turn that
// returns the full six cards costs about 428 tokens (docs/api-findings.md), so even
// a saturated window stays well inside the model's budget.
export const HISTORY_WINDOW_MESSAGES = 20;

ensureUsableDatabaseFile(MEMORY_DATABASE_PATH);

export const storage = new LibSQLStore({
  id: 'commerce-store',
  url: `file:${MEMORY_DATABASE_PATH}`,
});

// Constraints a shopper states once are expected to hold for the whole conversation, but
// recall is a sliding window: state made 11 turns ago is no longer in the prompt to be
// reasoned about. Mastra renders working memory as a system message rather than a
// conversational turn, so these four fields survive eviction while the window stays at 20.
// Each field is one of the carry-forward behaviours "Follow-up turns" already asks for in
// instructions.ts; nothing is stored that the agent has no instruction to act on.
export const shopperStateSchema = z.object({
  statedMaxPrice: z.number().nullable().describe('Budget the shopper stated, in dollars.'),
  shownProductIds: z
    .number()
    .array()
    .describe('Ids of every product already shown, so "show me more" returns new options.'),
  excludedBrands: z.string().array().describe('Brands the shopper ruled out.'),
  categoryInterest: z
    .string()
    .nullable()
    .describe('Category slug the shopper is shopping in, carried across refinements.'),
});

export const commerceMemory = new Memory({
  storage,
  options: {
    lastMessages: HISTORY_WINDOW_MESSAGES,
    // Thread scope, not the 'resource' default: one shopper drives every conversation
    // (LOCAL_RESOURCE_ID), so resource scope would carry one session's budget and shown
    // products into the next unrelated one.
    workingMemory: { enabled: true, scope: 'thread', schema: shopperStateSchema },
  },
});
