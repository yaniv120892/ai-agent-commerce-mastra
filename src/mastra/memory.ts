import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import path from 'node:path';
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

export const commerceMemory = new Memory({
  storage,
  options: { lastMessages: HISTORY_WINDOW_MESSAGES },
});
