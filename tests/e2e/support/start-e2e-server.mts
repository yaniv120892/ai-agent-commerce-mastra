import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Launches the production server the end-to-end suite runs against, plus the stand-in
 * OpenAI Responses API it talks to.
 *
 * Two things make this a script rather than a plain `next start` in
 * playwright.config.ts:
 *
 * 1. Memory lives at `process.cwd()/commerce-memory.db`, so the server is started from
 *    a throwaway directory — `next start <projectDirectory>` still reads the build from
 *    the checkout. A run therefore never touches the database a developer is using, and
 *    every run starts from an empty conversation list.
 * 2. The model is stubbed by pointing `OPENAI_BASE_URL` at a local fake, which has to
 *    be listening before the first turn. Starting it here removes any ordering question
 *    between Playwright's global setup and its web server.
 *
 * The model is the only stubbed piece. The route, agent, tool, live catalog fetch,
 * LibSQL memory and UI are all real: the suite proves persistence and navigation, not
 * model quality, and a real key must never leave the parent checkout.
 *
 * It is a `.mts` file run directly by Node's type stripping, so it is type-checked and
 * linted with the rest of the repo rather than living as untyped JavaScript.
 */

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const FAKE_OPENAI_PORT = Number(process.env.E2E_FAKE_OPENAI_PORT ?? 4317);
const RUNTIME_DIRECTORY_NAME = 'commerce-copilot-e2e';

const DEFAULT_TOOL_NAME = 'resolveProducts';

// Fixed rather than derived from the shopper's words: the suite asserts that cards are
// present and survive a reload, so retrieval has to hit the live catalog on every run
// regardless of how a prompt is phrased.
const STUBBED_CRITERIA = {
  searchTerms: ['smartphone', 'phone'],
  categorySlug: 'smartphones',
  maxPrice: 400,
};

const STUBBED_REPLY = 'Here are the smartphones under $400 that the catalog search returned.';

const projectDirectory = path.resolve(fileURLToPath(import.meta.url), '../../../..');

await main();

async function main(): Promise<void> {
  const fakeOpenAi = await startFakeOpenAiServer(FAKE_OPENAI_PORT);
  const runtimeDirectory = prepareRuntimeDirectory();
  const nextBinary = path.join(projectDirectory, 'node_modules', 'next', 'dist', 'bin', 'next');

  const child = spawn(
    process.execPath,
    [nextBinary, 'start', projectDirectory, '--hostname', '127.0.0.1', '--port', String(APP_PORT)],
    {
      cwd: runtimeDirectory,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Set here rather than read from a .env file: the suite must stay stubbed even
        // in a checkout that holds a real key. `@next/env` does not override variables
        // that are already present in the environment.
        OPENAI_API_KEY: 'e2e-stub-key-not-a-real-credential',
        OPENAI_BASE_URL: `http://127.0.0.1:${fakeOpenAi.port}/v1`,
        OPENAI_MODEL: process.env.OPENAI_MODEL ?? 'gpt-5.4-mini',
        MASTRA_TELEMETRY_DISABLED: '1',
      },
    },
  );

  const forwardSignal = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };

  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  child.on('exit', (code) => {
    void fakeOpenAi.close().finally(() => {
      process.exit(code ?? 0);
    });
  });
}

function prepareRuntimeDirectory(): string {
  const runtimeDirectory = path.join(os.tmpdir(), RUNTIME_DIRECTORY_NAME);
  fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  fs.mkdirSync(runtimeDirectory, { recursive: true });

  return runtimeDirectory;
}

type FakeOpenAiServer = {
  port: number;
  close: () => Promise<void>;
};

async function startFakeOpenAiServer(port: number): Promise<FakeOpenAiServer> {
  const server = http.createServer((request, response) => {
    void handleModelRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    port: readBoundPort(server),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function handleModelRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  if (!request.url?.endsWith('/responses')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: { message: `Unhandled path in the fake OpenAI server: ${String(request.url)}` },
      }),
    );
    return;
  }

  const body = await readJsonBody(request);

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  for (const event of buildResponseEvents(body)) {
    response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  response.end();
}

/**
 * A request whose last input item is a tool result gets prose; anything else gets a
 * call to the catalog tool. That is the two-step shape of a real turn.
 */
function buildResponseEvents(body: Record<string, unknown>): Record<string, unknown>[] {
  const created = {
    type: 'response.created',
    response: {
      id: `resp_${Date.now()}`,
      created_at: Math.floor(Date.now() / 1000),
      model: typeof body.model === 'string' ? body.model : 'stub-model',
    },
  };

  const completed = {
    type: 'response.completed',
    response: { usage: { input_tokens: 12, output_tokens: 8 } },
  };

  const turn = lastInputItemIsToolResult(body) ? proseEvents() : toolCallEvents(body);

  return [created, ...turn, completed];
}

function toolCallEvents(body: Record<string, unknown>): Record<string, unknown>[] {
  const callId = `call_${Date.now()}`;
  const item = {
    type: 'function_call',
    id: `fc_${callId}`,
    call_id: callId,
    name: readToolName(body),
    arguments: JSON.stringify(STUBBED_CRITERIA),
  };

  return [
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
    { type: 'response.output_item.done', output_index: 0, item: { ...item, status: 'completed' } },
  ];
}

function proseEvents(): Record<string, unknown>[] {
  const itemId = `msg_${Date.now()}`;

  return [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: itemId } },
    { type: 'response.output_text.delta', item_id: itemId, delta: STUBBED_REPLY },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: itemId } },
  ];
}

function lastInputItemIsToolResult(body: Record<string, unknown>): boolean {
  const input = body.input;
  if (!Array.isArray(input) || input.length === 0) {
    return false;
  }

  const lastItem: unknown = input[input.length - 1];
  if (typeof lastItem !== 'object' || lastItem === null) {
    return false;
  }

  return Reflect.get(lastItem, 'type') === 'function_call_output';
}

function readToolName(body: Record<string, unknown>): string {
  const tools = body.tools;
  if (!Array.isArray(tools)) {
    return DEFAULT_TOOL_NAME;
  }

  for (const tool of tools) {
    if (typeof tool !== 'object' || tool === null) {
      continue;
    }

    const name = Reflect.get(tool, 'name');
    if (typeof name === 'string' && name.length > 0) {
      return name;
    }
  }

  return DEFAULT_TOOL_NAME;
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    record[key] = value;
  }

  return record;
}

function readBoundPort(server: http.Server): number {
  const address: string | AddressInfo | null = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error(`The fake OpenAI server bound no TCP port (address: ${String(address)})`);
  }

  return address.port;
}
