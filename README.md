# AI Commerce Copilot

A shopping assistant over the DummyJSON catalog. A Mastra agent retrieves products with a
single tool and the UI renders cards from the structured tool result; conversations persist
across reloads and server restarts in a local LibSQL database.

`CLAUDE.md` holds the architecture contract. `docs/api-findings.md` is the source of truth
for the catalog API, and `docs/spike-findings.md` records what the integration spike proved.

## Getting started

```bash
npm install
cp .env.example .env   # then put a real OPENAI_API_KEY in .env
npm run dev
```

`OPENAI_MODEL` defaults to `gpt-5.4-mini`; `gpt-5.4-nano` is the only other permitted value.

| Command                | Purpose                     |
| ---------------------- | --------------------------- |
| `npm run dev`          | Dev server (Turbopack)      |
| `npm run build`        | Production build            |
| `npm test`             | Vitest unit tests           |
| `npm run test:e2e`     | Playwright end-to-end tests |
| `npm run lint`         | ESLint                      |
| `npm run format:check` | Prettier verification       |
| `npm run typecheck`    | `tsc --noEmit`              |

## API

| Route                      | Behaviour                                                        |
| -------------------------- | ---------------------------------------------------------------- |
| `POST /api/chat`           | Streams a turn from the commerce agent into an existing thread   |
| `GET /api/chat?threadId=…` | Returns stored history for a thread as AI SDK v6 UI messages     |
| `GET /api/conversations`   | Lists conversations, newest first                                |
| `POST /api/conversations`  | Creates a conversation and returns its id                        |
| `GET /api/health`          | Loads the Mastra primitives; guards the module-resolution config |

A conversation must exist before `POST /api/chat` can write to it — create it first and
reuse the returned id. The first user message backfills the thread title (trimmed to 60
characters, no LLM call), so a conversation may be created with no title at all.

## Persistence

Threads and messages live in `commerce-memory.db` (LibSQL, gitignored). Tool results are
stored as part of the assistant message, so product cards re-render from history after a
reload or a full server restart — there is no separate table for them.

This app runs locally for one person and **has no authentication**. Every thread is filed
under the constant resource id `local-user`, which is a namespace, not an identity.

Recall is bounded to the last 20 stored messages (`HISTORY_WINDOW_MESSAGES` in
`src/mastra/memory.ts`) — roughly ten shopper turns. Mastra's own default is 10; the value
is set explicitly so a library upgrade cannot move the window silently.

## Error handling

Four failures are handled deliberately rather than left to surface as stack traces.

**A missing or corrupt database file is recreated, not fatal.** `ensureUsableDatabaseFile`
runs before the store is constructed. A missing file (and its parent directory) is created
on demand. A file that exists but does not begin with the SQLite header — truncated, or
overwritten by something that is not a database — is renamed to `commerce-memory.db.corrupt-<timestamp>`
and a fresh database takes its place. Without this, libsql throws on the first query rather
than at open time, so the failure would appear as an unrelated 500 much later.

**An unknown `threadId` is a 404, never a 500.** `memory.recall()` throws
`No thread found with id <id>` instead of returning an empty result, so both chat routes
check `getThreadById` first and answer `Conversation not found (threadId: …)`. A thread that
exists but has no messages yet is a normal `200` with an empty list.

**A write that fails mid-turn reaches the user.** Anything that fails before the stream
opens becomes a JSON error response with a status. Once the stream is open a status is no
longer available, so `handleChatStream`'s `onError` emits an error part — the client sees
"The assistant could not finish this reply: …" instead of a turn that simply stops.

**History written by an earlier tool set cannot mute the conversation.** Recall replays
stored turns verbatim, including calls to tools that have since been renamed or removed.
OpenAI answers such a prompt with an empty `stop` turn and no tool calls, which is what
made long-lived threads go silent while fresh ones kept working.
`KnownToolsOnlyProcessor` strips those calls (and their results) from the outgoing prompt
only — stored history and the rendered cards are untouched.
