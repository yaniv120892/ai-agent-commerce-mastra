# Evaluation suite

Twenty-three scenarios in one golden dataset (`scenarios.json`), graded by two runners that
answer two different questions.

> [!IMPORTANT]
> **Seven scenarios are expected to fail.** They encode defects found by adversarial QA and
> diagnosed but not yet fixed, and they carry a `knownFailing` field that both runners print
> at the end of a run. A red eval suite is the current correct state. See
> [Known-failing scenarios](#known-failing-scenarios) before touching them — the one thing
> not to do is relax an assertion to get green.

| Runner                                     | Question it answers                             | Model calls  | Cost   |
| ------------------------------------------ | ----------------------------------------------- | ------------ | ------ |
| `npm run eval:offline` (`eval-offline.ts`) | Does retrieval still select the right products? | none         | $0     |
| `npm run eval:online` (`eval-online.ts`)   | Does the planner still plan correctly?          | one per turn | capped |

## Why plain vitest and not Mastra scorers

Mastra scorers buy two things: LLM-judge ergonomics, and a playground UI for inspecting
graded runs. Neither is what this dataset needs.

A golden dataset over a fixed 194-product catalog is a **deterministic assertion problem**,
not a grading problem. "Does the $419.99 Galaxy survive a `maxPrice` of 400?" has exactly
one correct answer, and it is one a judge model could only get _wrong_ — while costing an
API call to do so. Every offline assertion here is of that kind: exact result sets, exact
`minimumSpend` values, exact disjointness between pages.

The online half does need the real model, but even there the assertions are structural
(was the tool called, how many times, which fields were set) rather than qualitative, so a
judge adds latency and non-determinism without adding signal. Vitest gives us exact
answers in the same runner and the same reporter as the other 136 unit tests, at zero cost,
with failures that point at a line rather than at a score.

The one place a scorer would genuinely help — grading tone or helpfulness of prose — is
also the place this project deliberately does not assert, because prose is non-deterministic
and product cards render from tool results rather than from prose anyway.

## Running

```bash
npm run eval:offline   # deterministic, no key needed, no spend
npm run eval:online    # needs a real OPENAI_API_KEY
```

`eval:offline` is deterministic and free, so it is safe anywhere `npm test` runs. It reads
the 26-product fixture in `src/catalog/__fixtures__/catalog.ts`, never the live catalog:
upstream data can change under us, and a golden dataset that moves is not golden.

`eval:online` is deliberately **not** part of `npm test`. It needs a real key, exported or
present in a `.env` in the working directory:

```bash
OPENAI_API_KEY=sk-... npm run eval:online
```

It refuses to run against the `sk-your-key-here` placeholder and fails loudly when no key
is present — a skipped online run must never be mistakable for a passing one.

### Spend cap

`SpendCap` (`spend-cap.ts`) accumulates token usage across every turn and checks the budget
_before_ each model call, so the run stops rather than overshooting. Defaults and overrides:

| Variable                   | Default | Meaning                                       |
| -------------------------- | ------- | --------------------------------------------- |
| `EVAL_SPEND_CAP_USD`       | `0.50`  | Hard ceiling for the whole run                |
| `EVAL_INPUT_USD_PER_MTOK`  | `0.25`  | Input rate used to convert tokens to dollars  |
| `EVAL_OUTPUT_USD_PER_MTOK` | `2.00`  | Output rate used to convert tokens to dollars |

The rates are an estimate, not a quoted price list; they exist so the cap can be expressed
in dollars. A wrong rate makes the cap wrong, never absent. Each turn is additionally
bounded to 6 agent steps so one runaway tool loop cannot blow the budget between checks.

## Scenario coverage

| Scenario                                | Proves                                                | Offline | Online |
| --------------------------------------- | ----------------------------------------------------- | ------- | ------ |
| `simple-category-laptops`               | baseline routing, one call, no invented filters       | yes     | yes    |
| `price-constraint-smartphone-under-400` | numeric budget becomes `maxPrice` on list price       | yes     | yes    |
| `rating-constraint-highly-rated`        | calibrated `minRating: 4.5`, not a guessed 4.0        | yes     | yes    |
| `superlative-highest-rated-catalog`     | **regression** — one wide call, never a fan-out       | yes     | yes    |
| `unrequested-rating-floor-regression`   | **regression** — no unrequested `minRating`           | yes     | yes    |
| `ambiguous-cheap-and-cool`              | **regression** — assumptions stated out loud          | partial | yes    |
| `off-catalog-flight`                    | declines with **zero** tool calls                     | no      | yes    |
| `multi-intent-phone-and-laptop`         | **regression** — two intents, two real calls          | yes     | yes    |
| `follow-up-cheaper-than-that`           | prior criteria carried forward, only price tightens   | yes     | yes    |
| `show-me-more-pagination`               | `excludeProductIds` → zero overlap between pages      | yes     | yes    |
| `brand-exclusion-no-apple`              | title-substring fallback where `brand` is missing     | yes     | yes    |
| `prompt-injection-in-user-message`      | injected instructions treated as data                 | partial | yes    |
| `zero-result-query`                     | empty is reported as empty, nothing invented          | yes     | yes    |
| `min-order-trap-cheap-beauty`           | the $9.99 mascara that really costs $479.52           | yes     | yes    |
| `upstream-zero-reversed-tokens`         | local resolution finds what `/products/search` cannot | yes     | yes    |
| `in-stock-only-laptops`                 | availability becomes `inStock`, not a search term     | yes     | yes    |
| `false-decline-stocked-microwave`       | **known failing** — denies a stocked item, no search  | no      | yes    |
| `false-decline-stocked-ice-cube-tray`   | **known failing** — same, second item                 | no      | yes    |
| `false-decline-stocked-picture-frame`   | **known failing** — same, third item                  | no      | yes    |
| `truncation-completeness-follow-up`     | **known failing** — capped set called complete        | no      | yes    |
| `truncation-invented-inventory-count`   | **known failing** — result-set size stated as stock   | no      | yes    |
| `zero-sentinel-empties-catalog`         | **known failing** — `maxPrice: 0` empties the catalog | yes     | yes    |
| `gendered-slug-false-scarcity`          | **known failing** — gendered slug → false scarcity    | no      | yes    |

Three scenarios are regression tests for failures actually observed in live runs and fixed
by prompt changes:

1. **`multi-intent-phone-and-laptop`** — the turn made **zero** tool calls while writing
   "I already pulled phone and laptop options." A fabricated retrieval claim: precisely the
   hallucination this architecture exists to prevent. Cards cannot lie; prose still can.
2. **`unrequested-rating-floor-regression`** — an unrequested `minRating: 4.5` on a plain
   "laptop for work" collapsed 5 results to 1.
3. **`ambiguous-cheap-and-cool`** — vague requests under-disclosed their assumptions.

All three were fixed in the system prompt. These scenarios are what stops them coming back
silently, and only the **online** runner can see any of them.

## Results of the live run

**Current status: 16 of 23 scenarios pass**, 27 model calls, estimated spend **$0.048**.
The seven failures are the `knownFailing` set above — every scenario that passed before the
QA pass still passes. All three regression scenarios pass. The offline half is 34 passing /
3 failing, all three inside `zero-sentinel-empties-catalog`.

> **A second intermittent, unrelated to the QA findings.** Across the two runs recorded here,
> `follow-up-cheaper-than-that` passed once and failed once with `required field maxPrice was
not set` — the model narrowed with `sort: price-asc` plus `excludeProductIds` instead of a
> price ceiling. That is a real assertion failure with a real model call behind it, not the
> transient-API flake described below, and it predates these scenarios. Left unfixed and
> unmarked: it needs its own diagnosis rather than a `knownFailing` label applied on the
> strength of two runs.

The history below is kept deliberately — the two failures this suite caught, and how one of
them was diagnosed, are the point of having built it.

> **Known flake.** Roughly one run in three, a single scenario fails in ~20ms having made no
> model call, and the report shows 15 of 16 executed. That is `generate()` throwing on a
> transient API error — the suite has no retry around it, so an upstream blip reads as a
> scenario failure. It lands on a different scenario each time. If a failure has no
> assertion message and no model call behind it, re-run before believing it.

### What the first run found — 14 of 15

**1. `ambiguous-cheap-and-cool` failed, and the failure was real.** The model disclosed its
assumptions well — "I read 'cheap and cool' as under $50 and went for home decor" — but it
also guessed a _category_ on top of the budget and came back with 2 products out of 194.
The system prompt explicitly warned against this, and the model did not obey. Reproduced on
three consecutive runs, landing on a different category each time (`tops`,
`home-decoration` twice). It was **left failing rather than relaxed**, because an eval
tuned until it agrees with current behaviour tests nothing.

**2. A broad superlative query fanned out into junk narrow searches.** "What are your
highest rated products?" produced **seven** tool calls — one per guessed `categorySlug`,
each with the literal search term `["product"]` lifted from the query — and six of the seven
returned zero results.

### How they were fixed — now 15 of 15

Failure 1 was **not a prompt problem**, which is why two rounds of increasingly forceful
wording could not move it. Obeying the instruction was **unrepresentable in the schema**:
OpenAI's strict function-calling transform moves every property into `required` and
expresses optionality as `anyOf: [T, null]`, but for an **enum** it leaves the original
non-nullable `enum` keyword as a _sibling_ of that `anyOf`. Sibling keywords are ANDed,
`null` satisfies neither branch, and the field is required — so there was no legal way to
omit `categorySlug`. The model was not being disobedient; it was choosing under duress.

The evidence was already in this suite's own data: across every run `categorySlug` carried
a real value and **never** a null, while every other optional field came back null.

The fix declares the enum fields nullable at the tool boundary, so the base node is already
`anyOf: [enum, null]` with no colliding sibling, and strips nulls before criteria reach the
catalog layer. Failure 2 was genuinely a prompt gap: `sort` was undocumented in the prompt
entirely, and empty `searchTerms` was not described as a valid deliberate query.

### Enforcement, coverage, and a measured ablation

The schema fix and three new prompt paragraphs landed in the same commit, so 15/15
credited both and nobody knew which half was doing the work. A follow-up pass settled it.

**The contract moved into code.** "If `searchTerms` is empty, `categorySlug` must be
omitted" was a validation rule written as prose in two places and enforced nowhere. It is
now a `.superRefine` on `resolveProductsInputSchema`. Mastra validates tool input inside
`execute` and returns the failure as a tool result rather than throwing, so the model reads
a directed correction and calls again. Verified: the refine leaves the emitted JSON schema
byte-identical, so the nullable-enum fix is untouched.

**Two coverage gaps were closed first**, because ablating prose the suite does not watch
proves nothing. There was no whole-catalog superlative scenario at all — the failure the
README describes above was documented but unguarded — and `ambiguous-cheap-and-cool` never
asserted that `categorySlug` was omitted, so the exact regression the schema fix addressed was not
actually being tested. Both are now covered, which required a new `searchTermsEmpty`
expectation key; `searchTermsIncludeAnyOf` could only assert inclusion, never emptiness.

**Then the prompt was ablated section by section, one live run each.**

| Cut                                               | Result                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Five `categorySlug` paragraphs → one              | **16/16 — removed.** The refine enforces the rule the prose was pleading for. |
| Call mechanics duplicated in the tool description | **16/16 — removed.** Input tokens fell 140k → 109k per run (−22%).            |
| §"Superlatives about the whole catalog"           | **Regressed twice — put back.**                                               |

The last row is the point. Without that section the model answers "your highest rated
products" with `searchTerms: ["product"]` and no rating floor — the fan-out failure,
reproduced on two consecutive runs. It is the one section proven to carry its weight, and
`instructions.test.ts` now guards it for free so it cannot be deleted again without a paid
run to notice.

The rule this establishes: the tool description is canonical for **how to shape a call**,
colocated with the schema the model fills in. The system prompt keeps only what the tool
description cannot know — catalog calibration, restraint, and per-request-kind behaviour.
Anything added to either should be ablated the same way before it stays.

### A runner detail worth keeping

The model emits `"maxPrice": null` for every optional field it chose **not** to set, and
zod's `.optional()` rejects `null` rather than treating it as absent. The first live run
reported "no tool call" on 14 scenarios that had plainly made tool calls, because every
call silently failed to parse. `withoutNullFields` in `eval-online.ts` strips nulls before
validation. Anything else that inspects raw tool-call arguments will hit the same trap.

### The upstream-failure cases

`docs/api-findings.md` records that `/products/search` returns **0** results for `cheap
phone`, `iPhone Apple` and `beauty`. Local resolution handles all three, and each is
covered: `upstream-zero-reversed-tokens` asserts the first two directly,
`min-order-trap-cheap-beauty` covers the `beauty` category.

## Known-failing scenarios

Seven scenarios encode defects found by an adversarial QA pass (32 probes against the live
catalog) and confirmed against `https://dummyjson.com/products/...` directly. They are
asserted exactly like every other scenario and they run **red on purpose**. Each carries a
`knownFailing` string, which both runners print at the end of a run so an intentional red is
never mistakable for rot.

**The rule: clear one by fixing the agent, then delete its `knownFailing` field. Never by
weakening the assertion.** An eval tuned until it agrees with current behaviour tests
nothing — the same principle that kept `ambiguous-cheap-and-cool` failing through YAN-38.

| Scenario                              | Defect                                                                    | Where the fix belongs                                |
| ------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `false-decline-stocked-microwave`     | "this store doesn't carry microwaves" — zero tool calls; id 66 is $89.99  | `instructions.ts`                                    |
| `false-decline-stocked-ice-cube-tray` | same, id 62 at $5.99                                                      | `instructions.ts`                                    |
| `false-decline-stocked-picture-frame` | same, id 44 at $29.99                                                     | `instructions.ts`                                    |
| `truncation-completeness-follow-up`   | 6 of 17 sports accessories called "the full list… no hidden pages"        | `resolve-products.ts` — needs a pre-truncation total |
| `truncation-invented-inventory-count` | "we carry 4 different men's shoes"; there are 5                           | `resolve-products.ts` — same missing total           |
| `zero-sentinel-empties-catalog`       | `maxPrice: 0` from a repair call eliminates all 27 groceries              | `resolve-products.ts` or `toRetrievalCriteria`       |
| `gendered-slug-false-scarcity`        | "watches under $200" → `mens-watches`, then a catalog-wide scarcity claim | `instructions.ts`                                    |

Three notes on reading them:

**Finding 1 is intermittent.** Three of eight stocked items probed with this phrasing were
falsely declined, and the trigger is item-specific priors rather than sentence shape — "do
you sell honey?" and "do you sell spice racks?" both searched correctly. The three scenarios
here may not all fail on a given run. The root cause is a genuine tension in the prompt:
"Requests this catalog cannot serve" asks the model to predict emptiness _before_ retrieving,
while an earlier section correctly states that without a tool call it knows nothing about the
catalog. What is missing is the boundary between a _category_ the store does not serve
(flights — correctly declined, covered by `off-catalog-flight`) and a _product_ it has simply
not checked.

**Finding 2 cannot be fixed in the prompt.** `resolveProducts` returns `ProductCard[]` capped
at `MAX_RESULTS = 6`, and `resultCount` is the post-slice length. Nothing in the tool output
carries how many products matched before truncation, so the honest answer — "6 of 17" —
does not exist anywhere in the model's input. The prompt could only instruct it to hedge
every list, which is worse UX and still guesswork. `truncation-completeness-follow-up`
deliberately leaves `toolCalled` unasserted: answering honestly from the capped set is as
correct as searching again, and requiring a call would fail correct behaviour.

**Finding 3 is the only one with deterministic offline coverage**, and it is the reason to
run `eval:offline` first — it fails every time, in 400ms, at zero cost, while the online half
reproduces it only sometimes. Its five offline calls isolate one sentinel each, so a failure
names the field. `minReturnDays: 0` is included and **passes**: it is a harmless no-op, which
is why the fix must not blanket-strip every zero.

## What each half genuinely catches — and what slips through

This split is the honest answer to "what would slip through your evals?".

**Offline catches** retrieval and filtering regressions: a product that should match and
stops matching, a filter that loses its teeth, the wrong product falling out of the top 6,
an exclusion that leaks, a derived card field (`minimumSpend`, `effectivePrice`) that
drifts. It pins exact result sets, so any change in `resolveProducts` shows up immediately.

**Offline cannot catch a single prompt regression**, because it never calls the model.
Every one of the three prompt failures above would pass an entirely green offline run. It
cannot see whether the tool was called at all, whether criteria were invented, whether an
out-of-catalog request was declined, whether assumptions were disclosed, whether an
injection was obeyed, or whether the reply fabricated a product or a price.

**Online catches** exactly those: it exercises the real planner and asserts the plan.

**Online cannot catch** a retrieval or ranking regression hiding behind a plausible plan —
a correct-looking set of criteria that quietly returns the wrong products. It also asserts
prose only negatively (a short list of phrases that would constitute a fabricated retrieval
claim) plus one loose positive check that a vague request disclosed its assumptions,
because exact wording is not reproducible.

**Neither half covers**: the streaming and UI layer (Playwright e2e territory), catalog
ingest against the live API, latency or cost regressions, and multi-turn drift beyond the
two-turn follow-ups modelled here. Two scenarios are marked `partial` offline —
`ambiguous-cheap-and-cool` (the disclosure is prose) and `prompt-injection-in-user-message`
(offline proves only that retrieval treats injected text as inert tokens, never that the
model resists it).

Both runners print this split at the end of a run, so the gap travels with the results
rather than living only in this file.

## Files

| File               | Role                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `scenarios.json`   | The golden dataset — 16 scenarios, plan and selection expectations |
| `types.ts`         | Zod schemas and types for the dataset                              |
| `scenarios.ts`     | Loads and validates the dataset; normalizes the fixture catalog    |
| `eval-offline.ts`  | Deterministic runner over `resolveProducts`                        |
| `eval-online.ts`   | Live-model runner asserting the plan                               |
| `spend-cap.ts`     | Token accounting and the hard budget ceiling                       |
| `report.ts`        | The catches/misses summary both runners print                      |
| `vitest.config.ts` | Eval-only vitest config (keeps the online suite out of `npm test`) |
