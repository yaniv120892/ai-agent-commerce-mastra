# Evaluation suite

Fifteen scenarios in one golden dataset (`scenarios.json`), graded by two runners that
answer two different questions.

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
| `unrequested-rating-floor-regression`   | **YAN-35 regression** — no unrequested `minRating`    | yes     | yes    |
| `ambiguous-cheap-and-cool`              | **YAN-35 regression** — assumptions stated out loud   | partial | yes    |
| `off-catalog-flight`                    | declines with **zero** tool calls                     | no      | yes    |
| `multi-intent-phone-and-laptop`         | **YAN-35 regression** — two intents, two real calls   | yes     | yes    |
| `follow-up-cheaper-than-that`           | prior criteria carried forward, only price tightens   | yes     | yes    |
| `show-me-more-pagination`               | `excludeProductIds` → zero overlap between pages      | yes     | yes    |
| `brand-exclusion-no-apple`              | title-substring fallback where `brand` is missing     | yes     | yes    |
| `prompt-injection-in-user-message`      | injected instructions treated as data                 | partial | yes    |
| `zero-result-query`                     | empty is reported as empty, nothing invented          | yes     | yes    |
| `min-order-trap-cheap-beauty`           | the $9.99 mascara that really costs $479.52           | yes     | yes    |
| `upstream-zero-reversed-tokens`         | local resolution finds what `/products/search` cannot | yes     | yes    |
| `in-stock-only-laptops`                 | availability becomes `inStock`, not a search term     | yes     | yes    |

Three scenarios are regression tests for failures actually observed in YAN-35 and fixed by
prompt changes:

1. **`multi-intent-phone-and-laptop`** — the turn made **zero** tool calls while writing
   "I already pulled phone and laptop options." A fabricated retrieval claim: precisely the
   hallucination this architecture exists to prevent. Cards cannot lie; prose still can.
2. **`unrequested-rating-floor-regression`** — an unrequested `minRating: 4.5` on a plain
   "laptop for work" collapsed 5 results to 1.
3. **`ambiguous-cheap-and-cool`** — vague requests under-disclosed their assumptions.

All three were fixed in the system prompt. These scenarios are what stops them coming back
silently, and only the **online** runner can see any of them.

## Results of the live run (YAN-38)

The online suite **was executed** against the real model (`gpt-5.4-mini`) and the live
catalog: **14 of 15 scenarios pass**, 17 model calls, ~93.5K input / 2.7K output tokens,
estimated spend **$0.03** against the $0.50 cap. All three YAN-35 regression scenarios
pass — the prompt fixes hold.

Two findings came out of it. Neither is a tooling problem, and neither is fixed here:
retuning the system prompt belongs to the prompt ticket, not to the eval ticket.

**1. `ambiguous-cheap-and-cool` fails, and the failure is real.** The model discloses its
assumptions well — "I read 'cheap and cool' as under $50 and went for home decor" — so the
YAN-35 disclosure fix holds. But it also guesses a _category_ on top of the budget and
comes back with 2 products out of 194. The system prompt explicitly warns against this
("Keep vague-request searches wide… guessing a budget and a category and a rating floor all
at once is how you end up with one result"), and the model does not obey it. Reproduced on
three consecutive runs, landing on a different category each time (`tops`, `home-decoration`
twice). The scenario asserts at least 3 products precisely because that prompt instruction
exists; it is left failing rather than relaxed, because an eval tuned until it agrees with
current behaviour tests nothing.

**2. A broad superlative query fans out into junk narrow searches.** Discovered while
building the pagination scenario, not currently asserted. "What are your highest rated
products?" produced **seven** tool calls — one per guessed `categorySlug`, each with the
literal search term `["product"]` lifted from the query — and six of the seven returned
zero results. The correct plan is one broad call with `minRating: 4.5` and no category at
all. This is the same family as the YAN-35 over-filtering failure, reached from a different
direction. Worth a prompt fix and a scenario of its own once fixed.

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

## What each half genuinely catches — and what slips through

This split is the honest answer to "what would slip through your evals?".

**Offline catches** retrieval and filtering regressions: a product that should match and
stops matching, a filter that loses its teeth, the wrong product falling out of the top 6,
an exclusion that leaks, a derived card field (`minimumSpend`, `effectivePrice`) that
drifts. It pins exact result sets, so any change in `resolveProducts` shows up immediately.

**Offline cannot catch a single prompt regression**, because it never calls the model.
Every one of the three YAN-35 failures above would pass an entirely green offline run. It
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
| `scenarios.json`   | The golden dataset — 15 scenarios, plan and selection expectations |
| `types.ts`         | Zod schemas and types for the dataset                              |
| `scenarios.ts`     | Loads and validates the dataset; normalizes the fixture catalog    |
| `eval-offline.ts`  | Deterministic runner over `resolveProducts`                        |
| `eval-online.ts`   | Live-model runner asserting the plan                               |
| `spend-cap.ts`     | Token accounting and the hard budget ceiling                       |
| `report.ts`        | The catches/misses summary both runners print                      |
| `vitest.config.ts` | Eval-only vitest config (keeps the online suite out of `npm test`) |
