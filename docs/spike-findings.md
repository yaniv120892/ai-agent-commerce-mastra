# Integration Spike Findings

Verdict: **all four unknowns clear. The stack as pinned in `CLAUDE.md` works end to end.**
No dependency fallback was needed. Two non-obvious runtime behaviours were found and are
now encoded in the scaffold; both are listed under "What downstream work must know".

Measured on 2026-07-18 against `gpt-5.4-mini` via the real OpenAI API. The throwaway
scaffold is one agent (`src/mastra/index.ts`), one trivial tool
(`src/mastra/tools/spike-catalog-tool.ts`), two routes (`src/app/api/chat/route.ts`,
`src/app/api/chat/history/route.ts`), and one page (`src/app/spike/page.tsx`).

---

## 1. `@mastra/ai-sdk@1.6.2` ↔ `ai@7.0.31` wire compatibility — **PASS, with a required option**

`handleChatStream` streams to `ai@7`'s `createUIMessageStreamResponse` and `@ai-sdk/react@4`'s
`useChat` correctly. The missing peer dependency on `ai` is real but did not produce a
broken combination.

**`version: 'v6'` must be passed to `handleChatStream`.** The default (`v5`) does not
typecheck against `ai@7`:

```
Type 'V5UIMessageStream<V5UIMessage>' is not assignable to
     'ReadableStream<UIMessageChunk<unknown, UIDataTypes>>'.
  Types of property 'finishReason' are incompatible.
    Type '"unknown"' is not assignable to type 'FinishReason | undefined'.
```

`ai@7` dropped `'unknown'` from the `FinishReason` union; the vendored v5 types still carry
it. Passing `version: 'v6'` makes `tsc --noEmit` clean.

This is a **type-level** incompatibility only. Probed empirically by flipping the route to
`version: 'v5'` and POSTing a real turn: the SSE frames were byte-identical in shape, and
`tool-output-available` arrived with a full payload. `v5` and `v6` emit the same wire
format for this surface. `v6` is required to compile, not to function — so a future
type-level surprise here is a compile error, never a silent runtime break.

Chunk type names (`tool-input-start`, `tool-input-delta`, `tool-input-available`,
`tool-output-available`) are identical across the vendored v5, vendored v6, and `ai@7`
declarations, which is why the wire format holds.

Provider contracts align as expected: `ai@7.0.31`, `@ai-sdk/openai@4.0.16`, and
`@ai-sdk/react@4.0.34` all resolve `@ai-sdk/provider@4.0.3`, exactly what `@mastra/core`'s
`provider-v7` alias points at.

**No fallback adopted.** `ai@6.x` + `@ai-sdk/react@3.x` is not needed.

## 2. `gpt-5.4-mini` resolves through `@ai-sdk/openai` — **PASS**

Resolves and executes tool calls. Confirmed from the persisted assistant message metadata,
which is provider-reported rather than echoed from our config:

```json
"metadata": { "modelId": "gpt-5.4-mini", "provider": "openai.responses" }
```

Spend was a handful of turns on a 3-item fixture catalog — well under a cent.

## 3. Tool parts round-trip on reload — **PASS, no side table needed**

The hard assignment requirement holds. Full sequence: POST a turn → `pkill` the dev server
→ restart → `GET /api/chat/history`. The `tool-*` part comes back intact:

```json
{
  "type": "tool-searchProducts",
  "toolCallId": "call_LeXcn1V6TW0KZpwnJOkJIjkc",
  "input": { "query": "laptops" },
  "output": { "query": "laptops", "products": [ ... 3 products ... ] },
  "state": "output-available"
}
```

`state: 'output-available'` and a populated `output` both survive. LibSQL persistence plus
`toAISdkMessages(messages, { version: 'v6' })` is sufficient.

**The `message_product_cards` side-table fallback is NOT needed.** Do not build it.

Verified in the browser too, not just over HTTP: `tests/e2e/spike-ui.spec.ts` sends a
message through the UI, asserts 3 cards render from the tool result, reloads, and asserts
they re-render. A separate run confirmed the same after a genuine server restart.

The `tools` record key becomes the client discriminant as documented — key `searchProducts`
→ part type `tool-searchProducts`.

## 4. Turbopack + `@mastra/core` — **PASS**

`next dev` on Turbopack (Next 16 default) runs the Mastra agent, LibSQL memory, and tool
execution with no bundling errors. `GET /api/health` still returns 200 with all four Mastra
primitives loaded. `serverExternalPackages: ['@mastra/*']` remains load-bearing and
untouched.

**No webpack fallback adopted.**

---

## What downstream work must know

Two behaviours cost debugging time here. Both are now handled in the scaffold, and both are
recorded in `CLAUDE.md` so later work does not rediscover them.

**`memory.recall()` throws on a thread that does not exist yet.** It raises
`Error: No thread found with id <threadId>` rather than returning an empty result, so a
first-visit history fetch 500s. Guard with `memory.getThreadById({ threadId, resourceId })`
and return an empty message list when it is null. The spike routes have since been retired;
the guard now lives in `GET` on `src/app/api/chat/route.ts`.

**Mastra persists the assistant message only when the stream completes.** Cards appear in
the UI at `tool-output-available`, which is well before the turn is durable. A reload
between those two points loses the entire turn — nothing is saved, not even partially. Any
test or UI flow that depends on history must wait for `useChat` status to reach `ready`,
not merely for cards to appear. This produced a genuine false-negative on unknown 3 before
it was understood; it is a race, not a persistence defect.

**`LibSQLStore` requires an `id`.** `new LibSQLStore({ url })` does not typecheck —
`LibSQLBaseConfig` requires `id`. Use `new LibSQLStore({ id: 'spike-store', url })`.

**History conversion uses `toAISdkMessages` from `@mastra/ai-sdk/ui`,** passing
`{ version: 'v6' }` to match the client. `toAISdkFormat` is deprecated and throws;
`toAISdkV5Messages` exists but produces the v5-typed shape.

---

## Not verified

Scoped out deliberately — flagged so nobody assumes coverage that does not exist.

- **Multi-turn threads.** Every test used a single user turn. Message ordering, context
  windowing, and `semanticRecall` across turns are unproven.
- **Concurrent threads / multiple resources.** One `threadId`/`resourceId` pair throughout.
- **Streaming interruption and resume.** `resumeStream` and the approval-response path in
  `handleChatStream` were not exercised.
- **Production build behaviour of the spike routes.** `npm run build` passes, but the
  end-to-end turns were driven against `next dev`. The health route is the only Mastra
  surface previously confirmed under a production build.
- **Error surfaces.** No tool-execution failure was induced, so `output-error` and the
  `onError` serializer are untested.
