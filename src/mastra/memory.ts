import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import path from 'node:path';

// Shared so the Mastra instance and the agents hang off one store. YAN-36 owns the
// durable memory configuration (working memory, recall window, storage location).
export const storage = new LibSQLStore({
  id: 'commerce-store',
  url: `file:${path.join(process.cwd(), 'commerce-memory.db')}`,
});

export const memory = new Memory({ storage });
