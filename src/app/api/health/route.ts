import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { createTool, noopObserve } from '@mastra/core/tools';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

// Touching the full Mastra surface here is deliberate. @mastra/* hard-depend on
// execa/ws/croner/posthog-node; if serverExternalPackages stops excluding them
// from the server bundle, this route fails at request time and nowhere else.
const healthTool = createTool({
  id: 'health-probe',
  description: 'Confirms Mastra primitives load inside a route handler',
  inputSchema: z.object({ ping: z.string() }),
  outputSchema: z.object({ pong: z.string() }),
  execute: async (inputData) => ({ pong: inputData.ping }),
});

export async function GET() {
  const probe = await healthTool.execute!({ ping: 'ok' }, { observe: noopObserve });

  return NextResponse.json({
    status: 'ok',
    probe,
    loaded: {
      mastra: typeof Mastra === 'function',
      agent: typeof Agent === 'function',
      memory: typeof Memory === 'function',
      libsqlStore: typeof LibSQLStore === 'function',
    },
  });
}
