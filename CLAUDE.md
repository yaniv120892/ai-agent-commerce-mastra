@AGENTS.md

# AI Commerce Copilot — Architecture Contract

This file is the contract every change in this project must follow. The initial scaffold
established it; later work extends the code but does not renegotiate these rules.

## Architecture rules

These are the load-bearing decisions. Breaking one is a review failure, not a style nit.

**1. The catalog layer has zero Mastra imports.**
`resolveProducts()` and everything else under `src/catalog/` is plain TypeScript over the
product data. It must be unit-testable without an LLM, an API key, or a Mastra runtime.
The agent tool is a _thin wrapper_ that adapts `resolveProducts()` to a Mastra tool — it
holds no ranking, filtering, or business logic of its own.

> If you find yourself importing from `@mastra/*` inside `src/catalog/`, the logic is in
> the wrong layer.

**2. Product cards render from tool-result parts, never parsed from prose.**
The UI reads structured tool results off the message stream and renders cards from that
data. Never regex/parse the model's natural-language output to recover product fields.
Prose is for the human; structured parts are for the UI.

**3. Filtering uses list price. `effectivePrice` is display-only.**
All price filtering, sorting, and range comparison operate on the list `price`.
`effectivePrice` (list price after `discountPercentage`) exists solely to show the user
what they would pay. Filtering on it produces results that contradict the stated query.

**4. `brand` is a soft ranking signal only.**
`brand` is missing on 92 of 194 products. Never use it as a hard filter or a required
field — doing so silently drops half the catalog. It may contribute to ranking score only.

**5. `docs/api-findings.md` is the source of truth for the DummyJSON API.**
Those numbers were measured, not assumed. Do not re-derive them, and do not code against
remembered API behaviour that contradicts them.

## Stack

Next.js 16 (App Router, Turbopack, `src/`), TypeScript, Tailwind v4, shadcn/ui.
Mastra for the agent runtime; Vercel AI SDK v7 for streaming; zod v4 for schemas.
Dependency versions are pinned exactly — see "Pinned dependencies" below.

## Environment-specific gotchas

Verified on this scaffold. Each cost real debugging time; do not undo them.

**`serverExternalPackages: ['@mastra/*']` in `next.config.ts` is mandatory.**
`@mastra/*` hard-depend on `execa`/`ws`/`croner`/`posthog-node`. Bundled into the server
build, they fail at _request_ time with opaque errors — the build stays green. Verified by
`GET /api/health`, which loads `Mastra`, `Agent`, `Memory`, and `LibSQLStore` and returns 200. If you touch bundling config, re-run that route before pushing.

**Next 16 uses Turbopack by default** for both `next dev` and `next build`. `--turbopack`
is no longer needed. A custom `webpack` config will _fail_ the build unless you pass
`--webpack`.

**`eslint-config-next` ships a native flat-config array.** Import it directly
(`eslint-config-next/core-web-vitals`). Do not wrap it in `FlatCompat` — that throws
`Converting circular structure to JSON`.

**Mastra tool `execute` takes input as the first positional argument:**
`execute: async (inputData, context) => ...`, not the older `({ context })` destructuring
form that appears in most training data and older Mastra docs. The `context` argument
requires an `observe` property; use the exported `noopObserve` when calling a tool
directly (in tests), never an `as` cast.

**`handleChatStream` must be called with `version: 'v6'`.** The default (`v5`) does not
typecheck against `ai@7` — the vendored v5 types still carry `finishReason: 'unknown'`,
which `ai@7` dropped from its `FinishReason` union. The wire format is identical either
way (verified against the live API), so this is a compile-time requirement, not a runtime one.
Match it on the read side with `toAISdkMessages(messages, { version: 'v6' })` from
`@mastra/ai-sdk/ui`. `toAISdkFormat` is deprecated and throws.

**`memory.recall()` throws on a thread that does not exist yet** —
`Error: No thread found with id <threadId>`, rather than returning an empty result. Any
history route must guard with `memory.getThreadById({ threadId, resourceId })` and return
an empty message list when it is null, or a first visit 500s.

**Mastra persists an assistant message only when the stream completes.** Tool results
render in the UI at `tool-output-available`, which is well before the turn is durable; a
reload between those two points loses the whole turn. Tests and UI flows that depend on
history must wait for `useChat` status `ready`, not merely for cards to appear.

**`LibSQLStore` requires an `id`.** `new LibSQLStore({ url })` fails to typecheck;
`LibSQLBaseConfig` requires `id`.

**Delete a route or page? Run `rm -rf .next` before `npm run typecheck`.** `tsconfig.json`
deliberately includes `.next/types/**/*.ts` for Next's route validation, so a stale build
cache keeps generating validators that import files you just removed — `tsc` then reports
`TS2307: Cannot find module '../../src/app/<deleted>/page.js'`. The errors are phantom: they
live in build output, not source, and vanish on a clean build. This is why the gate can pass
in a fresh worktree and fail on a long-lived checkout.

**A zod peer warning on `npm install` is expected and benign.** `@mastra/core` vendors a
nested `@ai-sdk/ui-utils-v5` peer-requiring zod `^3.23.8` against our hoisted zod 4.4.3.
`src/lib/mastra-zod-interop.test.ts` pins the interop so a real regression surfaces as a
failing test rather than a malformed tool schema at runtime.

## Model

`gpt-5.4-mini` is the project default, configured via `OPENAI_MODEL`. `gpt-5.4-nano` is
the only permitted alternative.

**`gpt-4o-mini` is NOT permitted.** The original design doc named it; that is a trap. The
allowed set for this assignment is exactly `gpt-5.4-mini` and `gpt-5.4-nano` — nothing
else, regardless of what older docs or training data suggest.

## Pinned dependencies

Exact versions, no `^`. `@mastra/libsql@1.16.0` peer-requires `@mastra/core >=1.51.0`, so
there is zero downgrade headroom on core.

```
@mastra/core@1.51.0   @mastra/memory@1.23.0   @mastra/libsql@1.16.0   @mastra/ai-sdk@1.6.2
ai@7.0.31   @ai-sdk/openai@4.0.16   @ai-sdk/react@4.0.34   zod@4.4.3
```

## Commands

| Command                | Purpose                     |
| ---------------------- | --------------------------- |
| `npm run dev`          | Dev server (Turbopack)      |
| `npm run studio`       | Mastra Studio (port 4111)   |
| `npm run build`        | Production build            |
| `npm test`             | Vitest unit tests           |
| `npm run test:e2e`     | Playwright end-to-end tests |
| `npm run lint`         | ESLint                      |
| `npm run format:check` | Prettier verification       |
| `npm run typecheck`    | `tsc --noEmit`              |

`build`, `test`, `lint`, and `format:check` are the quality gate. All four must pass
before any push. Never disable a check, use `--no-verify`, add `eslint-disable`, or skip a
test to get green.

## Secrets

The real `OPENAI_API_KEY` lives in `.env`, which is gitignored and must stay untracked.
`.env.example` is the tracked template and carries placeholder values only. Never commit a
real key, and never paste one into a tracked file, a test fixture, or a commit message.

## Code conventions

Project-wide, enforced in review:

- Explicit access modifiers on every class member (`public` / `private` / `protected`).
- `T[]`, never `Array<T>`.
- Braces on every control-flow body, including single-statement guards and early returns.
- No `as` casts. Narrow with type guards or a throwing guard instead.
- Self-documenting code over comments. Comment only genuine hacks, non-obvious invariants,
  or behaviour that would surprise an experienced reader.
- Public methods before private ones; a reader should grasp a module from its top portion.
- Types: exported types live in a dedicated types file; file-local types go at the top of
  the file.
- Prefer `switch` over long `else if` chains on a single value.
- No abbreviated identifiers (`cfg`, `ctx`, `svc`, `acc`). Names should read without
  domain context.
- Errors carry the offending values: include what was actually received, not just what was
  expected.
- Conventional Commits, scoped to the module touched: `feat(catalog): ...`, `fix(chat): ...`.
