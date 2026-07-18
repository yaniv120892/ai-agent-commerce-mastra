# AI Commerce Copilot

A shopping assistant over the [DummyJSON](https://dummyjson.com) catalog. You ask for
products in natural language; a Mastra agent decides what to retrieve, a plain-TypeScript
retrieval layer selects up to six products, and the UI renders them as cards built from the
structured tool result rather than from anything the model wrote.

This README is written to be argued with. Every number in it was measured against the real
API or the real model, and where I got something wrong on the first attempt I have said so
and said what the evidence was that corrected me.

---

## 1. Setup and running it

```bash
npm install
cp .env.example .env    # then put a real OPENAI_API_KEY in .env
npm run dev             # http://localhost:3000
```

`.env` is gitignored and must stay untracked; `.env.example` is the tracked template and
carries placeholders only. `OPENAI_MODEL` defaults to `gpt-5.4-mini` — `gpt-5.4-nano` is
the only other value the env schema accepts, and it rejects anything else at startup rather
than failing on the first request.

| Command                | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Dev server (Next 16 / Turbopack)                          |
| `npm run build`        | Production build                                          |
| `npm test`             | 162 unit and integration tests                            |
| `npm run test:e2e`     | 5 Playwright end-to-end tests — **needs a prior `build`** |
| `npm run eval:offline` | Deterministic eval, 29 assertions, no key, no spend       |
| `npm run eval:online`  | Live-model eval, needs a real key, capped at $0.50        |
| `npm run lint`         | ESLint                                                    |
| `npm run format:check` | Prettier                                                  |
| `npm run typecheck`    | `tsc --noEmit`                                            |

**On `npm run test:e2e`.** It drives the _production_ server, so `npm run build` has to have
run first. It needs **no API key** — `tests/e2e/support/start-e2e-server.mts` starts a local
stand-in for the OpenAI Responses API and points the app at it, so a real credential never
leaves the checkout even if one is sitting in `.env`. It does need **network access**,
because the model is the only stubbed component: the route, agent, tool, LibSQL memory, UI,
and the live catalog fetch are all real. The suite also starts the server from a throwaway
temp directory, so a run never touches the `commerce-memory.db` you have been using.

---

## 2. Architecture, and why Mastra

```
src/catalog/      pure TypeScript — fetch, cache, normalize, filter, rank.  Zero Mastra imports.
src/mastra/       agent, system prompt, LibSQL memory, and one thin tool wrapper.
src/app/api/      chat + conversations routes; streams with the Vercel AI SDK.
src/components/   chat shell and the product cards, rendered from tool-result parts.
evals/            15 golden scenarios, an offline runner and an online one.
```

The load-bearing decision is the first line of that tree: **`src/catalog/` has no Mastra
imports at all.** Retrieval is a pure function, `resolveProducts(criteria, catalog)`, and
the Mastra tool is a wrapper that adapts it — it holds no ranking, filtering, or business
logic of its own. Everything interesting about this project is therefore testable without a
framework, an API key, or an LLM in the loop, which is why 29 eval assertions and the bulk
of the 162 tests run in under three seconds for free.

### Why Mastra

I wanted three things off the shelf: an agent loop with tool-calling, durable
threaded memory, and streaming that reaches a React client with tool results intact as
structured parts. Mastra gives all three, and its `handleChatStream` → `useChat` path
delivers tool results as first-class message parts that survive persistence and a reload.
That last property is what the product-card architecture depends on, and I verified it
end-to-end during the spike (`docs/spike-findings.md`) before committing to it: POST a turn,
kill the server, restart, refetch history, and the `tool-resolveProducts` part comes back
with `state: 'output-available'` and a populated payload. It meant I did not need the
`message_product_cards` side table I had budgeted for.

**Rejected: the raw `openai` SDK.** This is not a hypothetical for me — a previous iteration
of this project did exactly that, and I re-implemented thread storage, message replay,
tool-call dispatch, and SSE streaming by hand. All of it is doable and none of it is where
the interesting problems in this assignment live. Against the deadline, hours spent
rebuilding a message store are hours not spent on retrieval, which is the part being graded.

**Rejected: LangChain / LangGraph.** Heavier abstraction over the same underlying primitive —
a model that emits tool calls — and its abstractions sit exactly on top of the retrieval flow
this assignment is explicitly about. A chain or a graph node would have hidden the thing I
most wanted to be able to point at and defend. LangGraph earns its complexity when you need
branching, cycles, and multi-agent handoffs; this is one agent with one tool.

### What Mastra cost me

I would rather own this than sell it.

- **A heavy dependency tree.** `@mastra/core@1.51.0` pulls `ws`, `execa@9.6.1`,
  `croner@10.0.1`, `posthog-node@5.45.2`, and `@a2a-js/sdk@0.3.14` — a cron scheduler, a
  process spawner, and an analytics client, for an app that does none of those things.
- **They break the bundler.** Those native-ish deps must be in
  `serverExternalPackages: ['@mastra/*']` or the build stays green and every request fails
  at runtime with an opaque error. `GET /api/health` exists specifically to catch that: it
  loads `Mastra`, `Agent`, `Memory`, and `LibSQLStore` and returns 200.
- **Fast version churn.** I pinned `1.51.0` while `1.52.0-alpha.7` was already published.
  Every version is exact, no carets, because `@mastra/libsql@1.16.0` peer-requires core
  `>=1.51.0` and there is zero downgrade headroom.
- **Telemetry is on by default.** `MASTRA_TELEMETRY_DISABLED=1` is in `.env.example` and set
  explicitly in the E2E harness.
- **It abstracts the agent loop**, which is the real cost: when behaviour is wrong you are
  debugging someone else's control flow. Section 6 has a case where the fix was only findable
  by capturing the outbound HTTP body rather than reading Mastra's source.

The mitigation is the architecture. Because the catalog layer is framework-free, a decision
to abandon Mastra costs me `src/mastra/` and the routes, and touches nothing that decides
which products a shopper sees.

---

## 3. Retrieval strategy

### The measurement that decided it

I spent the first pass probing the actual API rather than assuming it worked like a search
engine. `docs/api-findings.md` has the full record. The relevant part:

`/products/search?q=` is a **whole-phrase substring matcher** over title, description, brand,
and tags. It is not tokenized, not semantic, and not field-aware.

| Query                            | Upstream results                         |
| -------------------------------- | ---------------------------------------- |
| `cheap phone`                    | **0**                                    |
| `iPhone Apple` (words reversed)  | **0**                                    |
| `beauty` (a real category slug!) | **0**                                    |
| `Apple`                          | 10 — including a **$1.99 grocery apple** |

And: **there is no price, rating, stock, or category filter parameter anywhere in the API.**

So the API cannot answer "a smartphone under $400 with a rating above 4" at all. Retrieval
had to move into my code. That is not a preference; it is the only option the upstream
surface leaves.

### The shape that makes it cheap

194 products, ~88KB when I request only the 16 fields I use, ~340ms median cold fetch. That
is small enough to hold. `src/catalog/catalog-cache.ts` fetches once, caches for 5 minutes,
and de-duplicates concurrent misses with a single-flight promise so a burst of turns issues
one upstream request rather than N.

### Why I filter in code rather than in the prompt

The obvious alternative is to put the catalog in the context window and let the model filter.
I rejected it on two grounds, and the second is the stronger one.

**Cost.** A trimmed catalog in the prompt costs 16.8K–80.8K tokens _per turn_. Six selected
cards cost **428**. That is roughly **40× cheaper**, on every single turn, forever.

**Accuracy, which matters more.** Asking a model to scan 194 items and return everything
under $400 rated above 4 is a needle-in-a-haystack task that it gets *silently* wrong — it
returns a plausible list with two items missing and no signal that anything was dropped. A
comparison in code is exact, and it is unit-testable: I can assert that the $419.99 Galaxy
does not survive `maxPrice: 400`, and that assertion runs in a millisecond with no model
call. I would have made the same choice at 10× the token budget.

### The ranking algorithm

`src/catalog/resolve-products.ts`. Hard filters first (category, price range, rating, stock,
shipping days, return days), then lexical scoring over what survives, then sort, then
exclusions, then a cap of 6.

Scoring is weighted token overlap, scaled by query coverage:

```
score = Σ(field weight × match quality) × (0.25 + 0.75 × matchedTerms / totalTerms)
```

Field weights are title 10, tags 6, brand 4, description 2. An exact whole-title match
short-circuits to 1000. Tokens are lowercased, split on non-alphanumerics, and naively
singularized so "laptops" and "laptop" collide.

**The coverage scaling is what solves the grocery-apple trap.** Query
`["apple", "laptop", "tablet", "smartphone"]`: the $1.99 Grocery Apple scores a strong exact
hit on its title — it genuinely is called "Apple" — but it covers 1 of 4 terms, so its total
is multiplied by 0.4375, and it lands below the MacBook, the iPad, and the iPhone, which each
cover two. **Breadth beats depth**, which is exactly the right instinct for a shopping query,
and it is pinned by a test that asserts the ordering rather than merely asserting relevance.

Because the model's terms are scored independently and scaled by coverage, the system prompt
and the tool description both instruct it to emit several short specific terms
(`["laptop", "apple", "macbook"]`) rather than one long phrase
(`["apple laptop for work"]`). The prompt describes the actual scoring function, so the
model's incentives and the retriever's behaviour agree.

**The 4-character floor on partial matches is load-bearing.** Substring matching is allowed
only when both the term and the token are at least 4 characters. At 3, `"beauty"` contains
`"eau"`, so a search for _beauty_ surfaced **Gucci Bloom Eau de Parfum** — a fragrance, from
the wrong category, ranked on a nonsense match. A test caught that, not inspection, and the
regression test now asserts every result of a `beauty` search is actually in the `beauty`
category.

### The normalization layer the API cannot give you

The single highest-leverage finding in `docs/api-findings.md`: the logistics fields _look_
like free text but are **low-cardinality enums** — 6 distinct `shippingInformation` values, 5
`returnPolicy`, 10 `warrantyInformation`, exhaustive across all 194 products. So
`src/catalog/normalize.ts` parses them once at ingest into numbers: `shippingDays`,
`returnDays`, `warrantyMonths` (with `Lifetime warranty` → `Infinity`), plus derived
`effectivePrice` and `minimumSpend`.

That turns "something that ships fast" into `maxShippingDays: 2` and "make sure I can return
it" into `minReturnDays: 30` — exact numeric comparisons over fields the upstream API does
not expose and cannot filter on. **This is the layer you structurally cannot build when you
delegate filtering to someone else's API**, and it is the clearest argument for having moved
retrieval into code.

The mappings are exhaustive `satisfies Record<Enum, number>` objects, so adding an enum value
without deciding its numeric meaning fails to compile. An unrecognised value at runtime
throws `UnknownCatalogEnumValueError` naming the field, the value, and the product id.

### Discounts, and a decision that turned out not to matter

Every product has a `discountPercentage` (median 11%). I filter on **list price** and display
both prices, because filtering on the discounted price returns products that contradict the
stated query — ask for "under $400" and get a $450 item, which is confusing even when it is
technically cheaper. Then I checked whether the decision was load-bearing: at a $400
threshold, list price and discounted price both yield **156 products**. Zero difference. I
kept the rule for its correctness argument and recorded that it changes nothing today, so
nobody re-litigates it later on the assumption that it might.

### The three named cases

**Ambiguous** — _"something cheap and cool"_. The agent does not interrogate the shopper. It
applies **one** assumption — a budget — deliberately does **not** narrow to a category, and
states the guess in prose: _"I read 'cheap' as under $50 and went for gadgets rather than
clothing — say the word if you had a different budget in mind."_ The design point is that
**disclosure is what makes guessing safe, and breadth is what makes correction possible.** A
budget _plus_ an invented category returns 2 products out of 194; the shopper never sees the
range on offer, so they cannot tell you what they actually wanted, and the guess becomes
unfalsifiable. Section 6 covers why getting this to actually happen was not a prompt problem.

**Off-catalog** — _"book me a flight to Lisbon"_. The catalog sells physical goods in 24
categories. The agent declines with **zero tool calls**, names what the store does carry, and
does not present an unrelated product as a substitute. Running a search you already know will
be empty just to look diligent is worse than declining. The eval asserts the zero-call
property directly, and it is the one scenario that has no offline coverage at all, because
"didn't call the tool" is a property of the planner and never reaches `resolveProducts`.

**Multi-intent** — _"a phone and a laptop"_. Two intents means **two separate tool calls in
the same turn**, each with its own terms and filters, presented as two labelled groups. A
single blended query returns a muddle that serves neither half. The inverse rule matters just
as much: one _broad_ question ("your highest rated products") is **one wide call** — no
category, empty search terms, `sort: 'rating-desc'`, `minRating: 4.5` — never one call per
guessed category. Earlier, that query fanned out into **seven** calls, one per guessed
category, each carrying the placeholder term `["product"]`, and six of the seven returned
nothing.

Two calibration details fall out of the data: **"highly rated" is a fixed `minRating: 4.5`**,
not 4.0, because the catalog median is 3.86 and only 44 of 194 products reach 4.5 — 4.0 is an
unremarkable product here. And an **empty `searchTerms` list is a valid, deliberate query**
meaning "range over the whole catalog", not a hole to plug with a placeholder noun. Since the
score is scaled by coverage, a term every product shares carries no signal and only adds
noise.

---

## 4. Conversation and state

Mastra `Memory` backed by a LibSQL file at `commerce-memory.db` (gitignored). Threads and
messages both live there, and tool results are stored as part of the assistant message — so
**product cards re-render from history after a reload or a full server restart, with no
separate table for them.**

Recall is bounded to the last **20 stored messages** (`HISTORY_WINDOW_MESSAGES`), roughly ten
shopper turns. Mastra's own default is 10; I set it explicitly so a library upgrade cannot
move the window silently, and because the number should sit next to the cost it implies — a
turn returning all six cards is about 428 tokens, so even a saturated window is comfortable.

**There is no authentication.** Every thread is filed under the constant resource id
`local-user`. That is a namespace so the sidebar can list conversations, not an identity, and
nothing in this app should be read as multi-user. Saying so plainly is more useful than an
`auth` folder that implies otherwise.

### What happens when storage fails

This is the question the assignment actually asks, so here is the implemented behaviour
rather than an intention.

**Corrupted.** `ensureUsableDatabaseFile` runs _before_ the store is constructed and checks
that the file begins with the 16-byte `SQLite format 3\0` header. A file that fails that
check — truncated, or overwritten by something that is not a database — is renamed to
`commerce-memory.db.corrupt-<timestamp>` and a fresh database takes its place. Without this,
libsql throws on the first _query_ rather than at open time, so a corrupt file surfaces as an
opaque 500 on some unrelated route much later. A zero-length file is treated as fresh rather
than corrupt, because libsql creates the file before writing the header.

**Missing or cleared mid-conversation.** The file and its parent directory are recreated on
demand, so the app starts. The open conversation, however, is gone: `memory.recall()` throws
`No thread found with id <id>` rather than returning empty, so both chat routes check
`getThreadById` first and return a **404 with a clear message** — `Conversation not found
(threadId: …)` — never a 500. On the client, a failed hydration surfaces as an error in the
message pane rather than an infinite spinner, and "New chat" always works because it creates
a fresh thread through `POST /api/conversations` before the first turn is sent.

**Full.** A write failure before the stream opens becomes a JSON error response with a
status. Once the stream is open an HTTP status is no longer available, so `handleChatStream`'s
`onError` emits an error _part_ — the user reads "The assistant could not finish this reply:
…" instead of watching a turn silently stop. This is the honest limit: a disk-full failure at
the moment of persistence is reported, not recovered from, and the turn is lost.

**A subtler one — history that mutes the conversation.** Recall replays stored turns
verbatim, including calls naming a tool the agent no longer declares. OpenAI answers such a
prompt with an empty `stop` turn and no tool calls: long-lived threads go silent while fresh
threads keep working, with no error anywhere. `KnownToolsOnlyProcessor` strips those calls and
their results from the _outgoing prompt only_, leaving stored history and rendered cards
intact.

---

## 5. Evaluation

15 golden scenarios in `evals/scenarios.json`, graded by two runners that answer two
different questions. Full detail in `evals/README.md`.

| Runner                 | Question                                        | Cost                        |
| ---------------------- | ----------------------------------------------- | --------------------------- |
| `npm run eval:offline` | Does retrieval still select the right products? | $0, no model call           |
| `npm run eval:online`  | Does the planner still plan correctly?          | ~$0.036 against a $0.50 cap |

**Offline** is deterministic: 29 assertions over a fixed 26-product fixture, never the live
catalog, because upstream data can change under you and a golden dataset that moves is not
golden. It pins exact result sets, exact `minimumSpend` values, exact disjointness between
paginated pages.

**Online** runs the real `gpt-5.4-mini` against the live catalog: **15 of 15 scenarios pass**,
17 model calls, ~93.5K input / 2.7K output tokens, **$0.0359** estimated spend. `SpendCap`
accumulates usage and checks the budget _before_ each call so a run stops rather than
overshoots, and each turn is bounded to 6 agent steps so one runaway tool loop cannot blow the
budget between checks. It refuses to run against the `sk-your-key-here` placeholder and fails
loudly with no key — a skipped run must never be mistakable for a passing one.

Around them: **162 unit and integration tests** and **5 Playwright E2E tests** covering card
rendering, reload persistence, sidebar resume, and fresh-thread isolation.

**Why plain Vitest and not Mastra's scorers.** A golden dataset over a fixed catalog is a
_deterministic assertion problem_, not a grading problem. "Does the $419.99 Galaxy survive
`maxPrice: 400`?" has exactly one right answer — one an LLM judge could only get _wrong_,
while charging me an API call to do it. Even the online assertions are structural (was the
tool called, how many times, which fields were set) rather than qualitative. The one place a
judge would genuinely help is grading tone, which this project deliberately does not assert,
because prose is non-deterministic and cards render from tool results anyway.

### What slips through — the honest version

This split is the answer to "what would your evals miss?", and both runners print it at the
end of a run so the gap travels with the results.

**Offline cannot catch a single prompt regression.** It never calls the model. All three of
the real prompt failures below would sail through an entirely green offline run. It cannot
see whether the tool was called at all, whether criteria were invented, whether an off-catalog
request was declined, whether assumptions were disclosed, whether an injection was obeyed, or
whether the reply fabricated a product or a price.

**Online cannot catch a retrieval or ranking regression hiding behind a plausible plan** — a
correct-looking set of criteria that quietly returns the wrong products. It asserts prose only
negatively (phrases that would constitute a fabricated retrieval claim) plus one loose check
that a vague request disclosed its assumptions, because exact wording is not reproducible.

**Neither half covers** the streaming and UI layer (Playwright territory), catalog ingest
against the live API, latency or cost regressions, or multi-turn drift beyond the two-turn
follow-ups modelled here. Two scenarios are marked `partial` offline for exactly this reason:
`ambiguous-cheap-and-cool` (the disclosure is prose) and `prompt-injection-in-user-message`
(offline proves only that retrieval treats injected text as inert tokens, never that the model
resists it).

---

## 6. Failure modes I anticipated, and what actually broke

These are real, they were caught by evidence, and three of them changed the code.

### The `minimumOrderQuantity` trap

The sharpest edge case in the dataset. A **$9.99 mascara has a minimum order quantity of 48**,
so buying it actually costs **$479.52**. Ask for "a cheap beauty product under $50" and the
naive correct-looking answer is a product that costs $479.

`minimumSpend` is computed at ingest, the card renders a `Min. order 48 · $479.52` badge, and
the system prompt requires the agent to lead with the real number whenever `minimumSpend` is
meaningfully above the unit price — especially when the shopper stated a budget. A scenario
(`min-order-trap-cheap-beauty`) pins it. I would not have found this by reading the schema; I
found it by looking at the distribution of every field.

### The agent fabricated a retrieval claim

During development, a multi-intent query produced **zero tool calls** while the model wrote
_"I already pulled phone and laptop options."_

This is the sharpest point in the submission, so I want to be precise about what the
architecture does and does not guarantee. Product cards render **only** from
server-produced tool output; the UI never parses prose to recover product fields. So a
**hallucinated product is structurally impossible** — there is no code path by which a model
that invents "iPhone 15, $599" causes a card to exist. **But prose can still lie.** The model
claimed to have searched when it had not, and no amount of tool-result-part discipline
prevents a sentence.

The fix was an explicit prompt rule ("never claim to have searched, pulled, or found anything
unless the tool call actually ran in this turn") plus a regression scenario that asserts a
two-intent query makes two real calls and that the reply contains no fabricated-retrieval
phrasing. The architectural guarantee covers cards, not sentences, and I would rather say that
than claim the design is airtight.

### The failure that looked like disobedience and was a JSON-schema impossibility

This is the one I am proudest of, because two rounds of prompt engineering were the wrong
answer and the evidence said so.

The eval showed the agent guessing a **category** on vague queries — "something cheap and
cool" coming back with 2 products out of 194 — in direct contradiction of an explicit prompt
instruction to keep vague searches wide. I strengthened the wording. It failed again. I
strengthened it further, in near-shouting terms. It failed again, landing on a _different_
category each run (`tops`, then `home-decoration` twice).

So I stopped tuning the prompt and captured the outbound request body to OpenAI. The
instruction was **unobeyable**. OpenAI's strict function-calling transform moves every
property into `required` and expresses optionality as `anyOf: [T, null]` — but for an **enum**
it leaves the original non-nullable `enum` keyword as a _sibling_ of that `anyOf`. Sibling
keywords are ANDed, `null` satisfies neither branch, and the field is required. **There was no
legal way to omit `categorySlug`.** The model was not ignoring me; it was choosing under
duress from a grammar in which "no category" could not be expressed — which is also exactly
why it picked a different category every time, having no basis for any of them.

The tell had been sitting in my eval data the whole time: across every run, `categorySlug`
carried a real value and **never** a null, while every other optional field came back null.

The fix is to declare the enum fields nullable at the tool boundary, so the base node is
already `anyOf: [enum, null]` with no colliding sibling, then strip nulls before criteria
reach the catalog layer (`resolveProducts` distinguishes an absent filter by `!== undefined`,
so a null would read as a real filter matching nothing). It lives in the Mastra adapter,
keeping `src/catalog/` provider-agnostic. That change took the online suite from 14/15 to
**15/15 with no assertion relaxed**, and it fixed the seven-call superlative fan-out at the
same time — the same root cause reached from a different direction.

The generalizable lesson: **when a model persistently disobeys a clear instruction, read the
wire before rewriting the prompt.** Prompt tuning against a schema-level impossibility fails
forever, and it fails in a way that looks like a model-quality problem.

### The persistence race that nearly cost me a redundant side table

Mastra persists an assistant turn only when the stream **completes**, but cards appear in the
UI at `tool-output-available` — well before the turn is durable. A reload between those two
points loses the entire turn, not partially: nothing is saved.

I hit this while verifying that tool parts survive a reload, and it produced a **false
negative** that nearly convinced me Mastra could not persist tool results at all. I had a
`message_product_cards` side table designed and scoped and was about to build it. The
behaviour is a race, not a persistence defect: any test or UI flow depending on history must
wait for `useChat` status `ready`, not merely for cards to appear. Understanding it saved a
whole table and the sync bugs that come with one — and it is a good reminder that a
disproven capability is worth re-testing before you architect around its absence.

---

## 7. Known limitations

- **Single-user, no auth.** One constant `resourceId`; every browser sees the same
  conversations. Multi-user would need real identity on the resource id and per-user scoping
  on every memory call.
- **Snapshots, not live commerce.** Prices, stock, and ratings come from a catalog cached for
  5 minutes. Nothing here is a real-time inventory guarantee.
- **No cart, checkout, or order state.** It recommends; it does not transact.
- **`brand` is a soft signal only** — it is missing on **92 of 194** products, so using it as
  a hard filter would silently drop half the catalog. Brand _exclusion_ therefore needs a
  title-substring fallback to work at all, which is what it does.
- **Strict enum parsing is deliberate but real.** A single unrecognised upstream
  `shippingInformation` value fails the whole catalog fetch. I chose loud failure over
  silently mis-filtering — a product treated as having unknown shipping would quietly vanish
  from every "ships fast" query — but it does mean one upstream change can take the app down,
  and a per-product quarantine would be the better long-run answer.
- **`gpt-5.4-nano` is untested end-to-end.** It is permitted by the env schema; the evals were
  run against `gpt-5.4-mini`.
- **The chat route trusts the client body.** `POST /api/chat` spreads the request body into
  `handleChatStream` and only overrides `memory`, so thread and resource scoping is safe, but
  any other field the client sends is forwarded to the agent. That is acceptable for a
  single-user local app and would not be for a deployed one: the fix is an explicit allowlist
  of the fields the route forwards. I left it as-is rather than narrowing the type late,
  because narrowing that object is exactly what breaks `handleChatStream`'s v6 overload
  resolution (see the comment in `src/app/api/chat/route.ts`) — doing it properly means
  constructing a correctly-typed params object, not adding a cast.

### Why I skipped embeddings

Two reasons, and the second is decisive.

First, there is **no embedding model on the assignment's allowed list** — `gpt-5.4-mini` and
`gpt-5.4-nano`, nothing else. A vector index I cannot populate is not a design choice.

Second, and more interesting: **price is not embeddable.** "Under $400" has no vector
operation. Every hard constraint in this domain — budget, rating floor, stock, shipping
window, return window, minimum order quantity — is a numeric comparison, and a numeric
comparison is exactly the thing embeddings cannot express. A vector index would have handled
the _lexical_ half of retrieval, which the coverage-scaled scorer already handles well enough
over 194 products, and would have done nothing at all for the half that actually drives the
answers. On a catalog of 194 items, an embedding index buys semantic synonymy and costs a
build step, a dependency, and a staleness problem. At 194,000 items I would revisit it — and I
would still filter numerically in code first and rank semantically within the survivors.

### With another week

1. **Per-product quarantine on ingest** instead of failing the whole fetch on one bad enum,
   with a surfaced count of skipped products so the failure stays loud without being fatal.
2. **A multi-turn drift eval.** Everything today is one or two turns; the twenty-message
   recall window is completely unexercised past that, and drift is where conversational agents
   actually rot.
3. **Streaming-layer evals.** Neither eval half sees the UI, so a regression that breaks card
   rendering while leaving the plan perfect is caught only by five Playwright tests.
4. **Attack the prose gap.** Cards cannot lie but sentences can. A cheap deterministic check —
   every price and product name in the reply must appear in a tool result from that turn —
   would convert the fabricated-retrieval class of bug from a prompt rule into an assertion.
5. **Real cost and latency tracking per turn**, surfaced in the eval report, so a prompt change
   that doubles token spend fails visibly rather than quietly.

---

## Reference

`CLAUDE.md` holds the architecture contract. `docs/api-findings.md` is the measured source of
truth for the catalog API. `docs/spike-findings.md` records what the integration spike proved
and, just as usefully, what it deliberately did not verify.

| Route                      | Behaviour                                                        |
| -------------------------- | ---------------------------------------------------------------- |
| `POST /api/chat`           | Streams a turn from the commerce agent into an existing thread   |
| `GET /api/chat?threadId=…` | Stored history for a thread, as AI SDK v6 UI messages            |
| `GET /api/conversations`   | Lists conversations, newest first                                |
| `POST /api/conversations`  | Creates a conversation and returns its id                        |
| `GET /api/health`          | Loads the Mastra primitives; guards the module-resolution config |

A conversation must exist before `POST /api/chat` can write to it. The first user message
backfills the thread title (trimmed to 60 characters, no LLM call), so a conversation may be
created with no title at all.
