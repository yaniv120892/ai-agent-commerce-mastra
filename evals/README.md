# Evaluation suite

Twenty-seven scenarios in one golden dataset (`scenarios.json`), graded by two runners that
answer two different questions.

> [!IMPORTANT]
> **One scenario carries a `knownFailing` marker.** `follow-up-cheaper-than-that` answers
> "cheaper than that" with `sort: price-asc` plus `excludeProductIds` and no `maxPrice` on
> roughly one run in three — which orders the results but never guarantees any of them is
> cheaper than what was already shown. It is now diagnosed, so it is marked; it spent a long
> time as an unlabelled flake, and that is what let a second, unrelated failure hide inside it
> (see [Two failures wearing one name](#two-failures-wearing-one-name)). See
> [Known-failing scenarios](#known-failing-scenarios) for the rule — the one thing not to do
> is relax an assertion to get green.
>
> One other scenario is **not perfectly reliable**: `pagination-ids-survive-window-eviction`,
> at roughly 8 runs in 10, deliberately unmarked; see
> [State that outlives the recall window](#state-that-outlives-the-recall-window).

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

| Scenario                                 | Proves                                                    | Offline | Online |
| ---------------------------------------- | --------------------------------------------------------- | ------- | ------ |
| `simple-category-laptops`                | baseline routing, one call, no invented filters           | yes     | yes    |
| `price-constraint-smartphone-under-400`  | numeric budget becomes `maxPrice` on list price           | yes     | yes    |
| `rating-constraint-highly-rated`         | calibrated `minRating: 4.5`, not a guessed 4.0            | yes     | yes    |
| `superlative-highest-rated-catalog`      | **regression** — one wide call, never a fan-out           | yes     | yes    |
| `unrequested-rating-floor-regression`    | **regression** — no unrequested `minRating`               | yes     | yes    |
| `ambiguous-cheap-and-cool`               | **regression** — assumptions stated out loud              | partial | yes    |
| `off-catalog-flight`                     | searches first, declines from the empty result            | no      | yes    |
| `multi-intent-phone-and-laptop`          | **regression** — two intents, two real calls              | yes     | yes    |
| `follow-up-cheaper-than-that`            | prior criteria carried forward, only price tightens       | yes     | yes    |
| `show-me-more-pagination`                | `excludeProductIds` → zero overlap between pages          | yes     | yes    |
| `pagination-remaining-count-honest`      | `remainingAfterThisPage` — page two never overstates      | no      | yes    |
| `brand-exclusion-no-apple`               | title-substring fallback where `brand` is missing         | yes     | yes    |
| `prompt-injection-in-user-message`       | injected instructions treated as data                     | partial | yes    |
| `zero-result-query`                      | empty is reported as empty, nothing invented              | yes     | yes    |
| `min-order-trap-cheap-beauty`            | the $9.99 mascara that really costs $479.52               | yes     | yes    |
| `upstream-zero-reversed-tokens`          | local resolution finds what `/products/search` cannot     | yes     | yes    |
| `in-stock-only-laptops`                  | availability becomes `inStock`, not a search term         | yes     | yes    |
| `false-decline-stocked-microwave`        | a stocked item is searched before it is denied            | no      | yes    |
| `false-decline-stocked-ice-cube-tray`    | same, second item                                         | no      | yes    |
| `false-decline-stocked-picture-frame`    | same, third item                                          | no      | yes    |
| `truncation-completeness-follow-up`      | `totalMatched` — a capped list is reported as partial     | yes     | yes    |
| `truncation-invented-inventory-count`    | `totalInCategory` — stock counted, not cards              | yes     | yes    |
| `zero-sentinel-empties-catalog`          | category browsing works; zero upper bounds ignored        | yes     | yes    |
| `gendered-slug-unrequested-narrowing`    | ambiguous product type omits the slug instead of guessing | no      | yes    |
| `gendered-slug-false-scarcity`           | `totalMatchedWithoutCategoryFilter` — no false scarcity   | partial | yes    |
| `budget-survives-window-eviction`        | budget survives eviction via working memory               | no      | yes    |
| `pagination-ids-survive-window-eviction` | shown ids survive eviction — _flaky, ~8/10_               | no      | yes    |

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

**Current status: 26 of 27 online scenarios pass.** Offline is **41 of 41**. The single failure
is `pagination-ids-survive-window-eviction`, the ~8-in-10 flake described below.
`follow-up-cheaper-than-that` passed this run; it is marked `knownFailing` because it fails
about one run in three, not every run.

The headline is the last full end-to-end sweep — 25 of 26 at 54 model calls and $0.170 — plus
`pagination-remaining-count-honest`, which was added afterwards and verified 3/3 over three
consecutive filtered runs (4 scenarios, 7 model calls, ~$0.021 each) alongside the three
scenarios it could disturb. It is not a fresh full sweep; budget one more model call than the
54 above for the added scenario.

**Working memory is not free.** Enabling it cost roughly **39% more input tokens on every
turn**, measured A/B on three single-turn scenarios that cannot benefit from it at all
(19,342 → 26,891 input tokens for the same 3 model calls). A full run went from 276k to
~614k tokens and $0.079 to $0.170. The eviction defect was real and worth fixing, but the
bill lands on every conversation, including the short ones that never approach the recall
window — the same objection that ruled out simply raising `lastMessages`.

**Budget for more calls than 54 from now on.** Declining an out-of-catalog request used to
cost one model call and no tool call; it now costs a search as well. That is the point of the
fix, but it lands hardest on the eviction pair, whose eleven filler turns are all
out-of-catalog by design — roughly 22 extra calls across a full run.

The eviction pair is by far the most expensive in the set — thirteen turns each against one or
two for everything else, roughly half the run's model calls between them — so the default
$0.50 cap now binds much sooner than it used to.

Finding 1 was intermittent while it was live — 3 of 8 stocked items probed were falsely
declined, driven by item-specific priors rather than sentence shape, and across the runs
recorded during that work the three scenarios failed variously zero, two, two and three at a
time. That is why the fix was measured over three runs in each direction rather than one: a
single green run never proved anything here. See
[The ablation for "search before you decline"](#the-ablation-for-search-before-you-decline).

> **`follow-up-cheaper-than-that` is now diagnosed and marked.** It had been failing since
> before the retrieval counts existed and was left unmarked on the principle that labelling an
> undiagnosed failure launders it into an accepted one. That principle was right, but carrying
> it unlabelled had a cost — see
> [Two failures wearing one name](#two-failures-wearing-one-name).
>
> Separately, `truncation-completeness-follow-up` twice failed in ~25ms having made no model
> call, then passed when run alone and again in the final full run. That is the transient-API
> flake described below — but note it landed on the _same_ scenario twice, which the original
> characterisation ("a different scenario each time") did not predict. If it recurs there
> specifically, it is worth a look rather than a re-run.

### The ablation for "search before you decline"

Deleting the no-search rule is a prompt change, so it was ablated the same way as everything
else here — cut it, restore the original paragraph, re-run. Three runs per variant, over the
three scenarios the rule broke plus the one whose assertions it had shaped:

| Variant                           | `false-decline-*` microwave | ice-cube-tray | picture-frame | `off-catalog-flight` |
| --------------------------------- | --------------------------- | ------------- | ------------- | -------------------- |
| **No-search rule deleted (kept)** | 3/3                         | 3/3           | 3/3           | 3/3                  |
| No-search rule restored           | **0/3**                     | **0/3**       | **0/3**       | **0/3**              |

`ambiguous-cheap-and-cool`, `superlative-highest-rated-catalog` and `simple-category-laptops`
held 3/3 in both variants, so nothing else moved.

The restored variant failing 0/3 across all three items is stronger than the defect looked
when it was first characterised as intermittent (zero, two, two and three failures across four
runs). Intermittency was real, but it was variance on top of a rule that reliably licensed the
wrong behaviour — not a defect that sometimes was not there.

This is the design principle the codebase already follows, applied in the direction of
_removal_: **reach for structure when the right answer is impossible or invisible to the
model, and for prose when it is merely unchosen.** No wording could have fixed this, because
the prompt was asking for a judgement — "is this search going to be empty?" — that the model
cannot make from outside the tool. Deleting the judgement was the fix.

### The ablation for "How many there are"

The counts are data; the section tells the model to read them. Three runs per variant, over
the three scenarios the counts affect:

| Variant                       | Size    | `truncation-completeness-follow-up` | `truncation-invented-inventory-count` | `gendered-slug-false-scarcity` |
| ----------------------------- | ------- | ----------------------------------- | ------------------------------------- | ------------------------------ |
| Full section as first written | 1045 ch | 3/3                                 | 3/3                                   | 3/3                            |
| **Trimmed (kept)**            | 361 ch  | 3/3                                 | **3/3**                               | 3/3                            |
| Cut entirely                  | 0       | 3/3                                 | **1/3**                               | 3/3                            |

Two thirds of what was first written was dead weight, and the pattern in which parts died is
the interesting result.

**Data that contains a visible contradiction needs no prose.** Completeness and false scarcity
both hold 3/3 with _no section at all_. A tool result showing `totalMatched: 1` beside
`totalMatchedWithoutCategoryFilter: 4`, or `17` beside 6 cards, is self-evident — the model
acts on it unaided, and the paragraphs explaining those two were deleted.

**Data that needs an interpretive rule does need prose.** Nothing in the result marks _which_
number answers "how many do you carry", so without the section the model still reports its
capped result set as the inventory — 1 of 3 runs. Note the failure is probabilistic, not
deterministic; the single-run ablation that first justified this section happened to catch it
and reported more confidence than one run can support.

The general rule this suggests: **prefer making the right answer structurally visible over
instructing the model to find it.** Reach for prose only where the data cannot speak for
itself, and measure which of those it actually is rather than assuming.

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
| §"How many there are" (added with the counts)     | **Cut to a third of its length — kept at 361 chars.** See below.              |

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

**One scenario runs red on purpose.** `follow-up-cheaper-than-that` carries a `knownFailing`
string describing a diagnosed, unfixed planning miss: about one run in three the model
narrows "cheaper than that" with `sort: price-asc` and `excludeProductIds` but no `maxPrice`,
so nothing in the result set is guaranteed to be cheaper than what the shopper already saw.
Both runners print the marker at the end of a run so an intentional red is never mistakable
for rot.

All seven of the original QA scenarios have been fixed: two plus half of a third by the
retrieval counts (see [What the retrieval counts fixed](#what-the-retrieval-counts-fixed)),
`zero-sentinel-empties-catalog` by making category browsing legal,
`gendered-slug-unrequested-narrowing` by the ambiguous-slug rule, and the three
`false-decline-*` scenarios by deleting the rule that told the model not to search. The
recall-window pair — a defect of the agent's memory rather than its judgement — was cleared by
working memory; see
[State that outlives the recall window](#state-that-outlives-the-recall-window).

**The rule: clear one by fixing the agent, then delete its `knownFailing` field. Never by
weakening the assertion.** An eval tuned until it agrees with current behaviour tests
nothing — the same principle that kept `ambiguous-cheap-and-cool` failing through YAN-38.

The table that listed them is gone with the last entry. What each defect was, and what closed
it, is recorded in the sections below.

Four notes on reading them:

**Finding 1 is fixed, by deleting an instruction rather than adding one.** The root cause was
a genuine contradiction in the prompt: "Requests this catalog cannot serve" told the model
_not to call the tool_ for things the catalog does not carry ("do not run a search you already
know will be empty"), while an earlier section correctly states that without a tool call it
knows nothing about the catalog. The first rule asks for a prediction the model cannot make —
it has no way to separate a _kind of commerce_ the store does not serve (flights) from a
_product_ it simply has not checked (ice cube trays) — so it answered from priors and denied
stocking three products the catalog carries, with **no tool call behind the denial** for any
eval, guardrail, or card render to catch.

The no-search rule is gone; an empty result, not a prior, is now the only thing that licenses
"we don't carry that". The rule was never buying much: `resolveProducts` is pure local
TypeScript over a cached catalog, so the entire cost of searching "book me a flight" is one
extra model round-trip. This trades an invisible expensive failure for a visible cheap one.

**This reversed a prior design decision, and one eval had to change with it.**
`off-catalog-flight` asserted `toolCalled: false, toolCallCount: 0` — that assertion _was_ the
defect, written into the dataset. It now asserts that the agent searched, declined from what
came back, and did not offer the loosely-matching junk a search may turn up as a substitute;
its `forbidden` patterns, which are the part that matters, are unchanged. Note what the live
runs showed: the flight search is **not** empty — the model reported finding "a non-flight
product" — so the scenario deliberately does not assert a zero result set. Asserting emptiness
would have failed on behaviour that is actually correct, because `resolve-products.ts` does
≥4-character substring matching across descriptions and something always scores.

**Finding 2 was fixed by the retrieval counts, not by the prompt** — see below.

**Finding 3 is fixed.** Two changes, because the sentinels were a symptom rather than the
cause. The cause was a validation rule rejecting empty `searchTerms` alongside a
`categorySlug` — which made "show me all your groceries" unexpressible, and the zero
sentinels were the model trying to repair around that rejection. Browsing a category is now
legal, and `maxPrice: 0` / `maxShippingDays: 0` are ignored as the placeholders they are.
`minReturnDays: 0` is deliberately left alone: it is already a no-op, and stripping every
zero would discard real filters alongside placeholders.

Removing that rule was the risk in this change — the README credits it with allowing five
`categorySlug` paragraphs to be deleted from the prompt. Measured over three runs on the four
scenarios that would show a regression (`ambiguous-cheap-and-cool`,
`superlative-highest-rated-catalog`, `simple-category-laptops`, plus the fixed scenario
itself): **12/12 pass.** The protection now lives in the tool description, which names the
thing actually worth preventing — picking a category the shopper never named — rather than
banning a field combination that has a legitimate use.

**Finding 4 was split in two**, because one scenario was asserting two separate defects and
that hid which half moved. `gendered-slug-unrequested-narrowing` asserts the slug guess;
`gendered-slug-false-scarcity` asserts only the claim it escalated into. The counts fixed the
second, and a prompt rule fixed the first — see below.

**Finding 4 is fixed, and it is the one place prose was the right instrument.** The two
earlier fixes were structural because the model was being asked for something it could not
supply: a catalog fact it had never retrieved, or a call the schema rejected. Omitting
`categorySlug` was never unavailable — the nullable-enum work made it fully representable, so
the model _could_ do the right thing and simply did not choose to. That is a judgement
failure, and judgement is what prose is for. One paragraph naming the product types that map
onto two slugs (watches, shoes, shirts/tops/dresses) took it from `mens-watches` on 4 of 4
runs to 0 of 3, with `simple-category-laptops` and `ambiguous-cheap-and-cool` holding 3/3
alongside it so the rule did not overshoot into never setting a slug at all.

The rule of thumb this leaves: **reach for structure when the right answer is impossible or
invisible, and for prose when it is merely unchosen.** Checking which one you have first is
cheaper than discovering it after a refactor.

**The two eviction scenarios were a different class from the four findings above.** Findings
1–4 are defects in what the model does with the information it has. Those two were defects in
what information it was given at all, which is why no wording in `instructions.ts` could clear
them — the constraint was not in the prompt to be reasoned about. They were the only
known-failing scenarios whose fix was architectural rather than a prompt or catalog change,
and they were the last two to go; see below.

## State that outlives the recall window

Every scenario above this section is one or two turns long, which meant the suite could not
observe the agent's behaviour on a long conversation at all. These two can.

`commerceMemory` recalls the last `HISTORY_WINDOW_MESSAGES` (20) messages. Measured against
the mock model in `src/mastra/agent-memory.test.ts`, **a turn stores exactly two messages**,
so the window holds ten turns: a sentinel stated on the first turn is still in the prompt
after ten turns and gone after eleven. Both scenarios state their constraint twelve turns
before the query that must honour it.

The eleven filler turns are deliberately out-of-catalog requests ("do you sell plane
tickets?"). **That choice was made under a prompt rule that no longer exists**, and the
justification has weakened accordingly: the agent used to decline those without retrieving,
which made the filler cheap and, more importantly, kept it from adding product ids that would
confound the exclusion assertion. Since the finding-1 fix, each filler turn issues a search,
so the filler costs roughly twice the model calls and may put ids into the exclusion set that
`pagination-ids-survive-window-eviction` did not anticipate. Both scenarios are red for an
unrelated, architectural reason, so this changes nothing about their verdict — but whoever
fixes the recall window should pick filler that cannot return products rather than filler that
merely used to not return them.

What the live run showed, with both scenarios run in isolation:

| Scenario                                 | Call the model actually made                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `budget-survives-window-eviction`        | `{"searchTerms":["gift","him","men"],"inStock":true,"sort":"relevance"}` — no `maxPrice`  |
| `pagination-ids-survive-window-eviction` | `{"searchTerms":["kitchen","accessories"],"categorySlug":"kitchen-accessories"}` — no ids |

Both failures are silent. Neither call is malformed, nothing throws, and the reply reads as a
helpful answer; it simply ignores a constraint the shopper still considers live. In the second
case the agent carried the category forward correctly — because the words "kitchen
accessories" were in the query itself — while losing the six ids that only ever existed in the
evicted tool result.

**This is not data loss, which is why a bigger window is the wrong fix.** The companion test
in `agent-memory.test.ts` asserts all three facts together: the constraint is absent from the
prompt, absent from `recall()`, and still present in storage when read with a wider window. It
still renders in the UI. Raising `lastMessages` moves the cliff further out and makes every
turn more expensive; it does not remove the cliff. The state a shopper expects to persist —
budget, excluded brands, products already seen — has to be held outside the transcript.

### What fixed them

Schema working memory on `commerceMemory`, holding four fields — `statedMaxPrice`,
`shownProductIds`, `excludedBrands`, `categoryInterest`. Mastra renders that block as a
**system** message rather than a conversational turn, so `lastMessages` never evicts it and
the constraint reaches the model on turn 13 exactly as it did on turn 1.
`HISTORY_WINDOW_MESSAGES` is still 20.

`scope` is `'thread'`, not the `'resource'` default, and the default would have been actively
harmful here: this suite gives every scenario a fresh thread but a single shared
`EVAL_RESOURCE_ID`, so resource scope would have leaked one scenario's budget and shown ids
into the other 25. The app has the same shape — one `LOCAL_RESOURCE_ID` for every
conversation — where it would carry one shopping session's budget into the next.

Two things were needed beyond enabling the feature:

**`shownProductIds` is written by the tool, not the model.** Every other field is something
the shopper said, which the model transcribes reliably. This one is six integers copied out of
a tool result and reproduced exactly on every later turn — left to the model it recorded them
on roughly 1 run in 3, and a near-miss is invisible, because a wrong id silently fails to
exclude the product it names. `resolveProductsTool` now appends the ids it just returned via
`recordShownProducts`, and the prompt tells the model to read that field and never write it.

**`KnownToolsOnlyProcessor` had to learn the working-memory tool name.** It drops any tool
call not in its allowlist along with its result, and it was constructed from
`Object.keys(COMMERCE_TOOLS)` alone. Left unfixed, the model's own `updateWorkingMemory` call
would vanish from the prompt at the next step of the same turn, so it would see no evidence it
had stored anything and call again until the step budget ran out.

### The ablation for the working-memory prompt changes

Enabling the feature injects Mastra's own ~1.5 KB block on every turn, which is not optional.
What _was_ optional is how much of `instructions.ts` had to change alongside it. Three runs
per variant, over the two eviction scenarios:

| Variant                                         | `budget-…-eviction` | `pagination-…-eviction` |
| ----------------------------------------------- | ------------------- | ----------------------- |
| Expanded "show me more" bullet + two paragraphs | 3/3                 | 3/3                     |
| **Expanded bullet only (kept)**                 | 3/3                 | **3/3**                 |
| Original one-line bullet, no paragraphs         | 3/3                 | **2/3**                 |

The two paragraphs — spelling out that a recorded budget or brand stays in force until the
shopper changes it — were **cut**. Mastra's injected block already tells the model to store
and read state, and repeating that in our own words bought nothing. What it cannot know is
which recorded field feeds which tool argument, and that is exactly what the surviving bullet
says. Same pattern as the counts ablation above: prose earns its place only where the
surrounding structure cannot speak for itself.

Read those counts with the flakiness noted below in mind: at three runs per variant, against
a scenario that passes about 8 times in 10 once fixed, a 3/3 and a 2/3 are weak evidence
individually. They are recorded because they agree with the mechanism — the surviving bullet
is the only text that says which field feeds which argument — not because three runs settle
it on their own.

One line was also added to the tool description, which is the other place the model reads
while it builds the call. Before it, the model would reach for `excludeProductIds` and send it
**empty** — the right field, unpopulated. That failure is what the line names explicitly.

Measured on the rebase onto `ebdd443`, where the five QA scenarios were already fixed: the
suite goes from 24/26 to **25/26**, both eviction scenarios passing. The one failure was
`off-catalog-flight`, which is **not** caused by this work — checked out at `ebdd443` with
none of these changes present, it fails 2 runs in 4 on its own. Deleting the no-search rule in
#22 changed how the model phrases a decline, and the scenario's regex does not cover all the
good ones: "I can't help book Tokyo travel here" is a correct refusal that matched none of the
listed patterns, because `can't (carry|sell|stock|offer|book)` did not allow for the word
"help" in between. **That has since been widened** to permit up to two words between the
negation and the verb, along with the rest of the repair described in
[Two failures wearing one name](#two-failures-wearing-one-name).

> **`pagination-ids-survive-window-eviction` is fixed but not yet reliable — roughly 8 runs
> in 10.** Both `knownFailing` markers were removed anyway, and the distinction matters.
> The defect they described is genuinely gone: the ids were previously _not in the prompt at
> all_, so the scenario could not pass, and they are now provably there on every turn — the
> thread's working memory reads `{"shownProductIds":[63,73,66,54,51,70],…}` in runs that fail
> as well as runs that pass. What remains is the model occasionally building the call without
> `excludeProductIds` despite holding the ids: an ordinary planning miss of the same kind as
> `follow-up-cheaper-than-that`, not a missing-information defect.
>
> It stays unmarked because it is not diagnosed to a fix. `knownFailing` is for diagnosed,
> unfixed defects with a known home for the fix — which is why `follow-up-cheaper-than-that`
> now carries one and this does not. Marking this would also assert something false: that the
> recall-window limit is still unaddressed. `budget-survives-window-eviction` passed every run
> observed.

## Two failures wearing one name

`follow-up-cheaper-than-that` had been failing intermittently for most of this project's
history, always with the same headline (`required field maxPrice was not set`), and was left
unmarked because it was undiagnosed. Running it in isolation showed it was **two different
failures sharing one scenario**:

| Mode             | Call the model made                                                | Why it failed                                                                                      |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| A (~1 run in 3)  | `sort: price-asc` + `excludeProductIds`, no `maxPrice`             | Real defect: ordering results never guarantees any of them is cheaper than what was already shown. |
| B (~2 runs in 3) | `maxPrice: 309.71`, `categorySlug: smartphones`, `searchTerms: []` | **Correct behaviour failing a stale assertion.**                                                   |

Mode B is the interesting one. The scenario asserted `searchTermsIncludeAnyOf`, written when
an empty term list alongside a category was _rejected by the schema_. Making category browsing
legal removed that constraint, and the model promptly started using it — narrowing by
`categorySlug: smartphones` with no keywords, which is at least as precise as keyword search.
The assertion was testing a limitation rather than a requirement, and it survived the
limitation's removal.

**The lesson is about the unmarked flake, not the assertion.** A scenario already believed to
be "sometimes red for unknown reasons" absorbs new signal silently: mode B appeared, the
scenario kept failing at roughly its usual rate, and nothing looked different. An undiagnosed
intermittent is not a neutral cost — it is a place where regressions can hide. The scenario now
asserts `categorySlug` for scope, still requires `maxPrice`, and carries a `knownFailing`
marker naming mode A precisely, so a change in its failure rate means something again.

`off-catalog-flight` failed the same way for a different reason. Requiring the tool call while
forbidding `"i (found|pulled|located)"` is self-contradictory once the agent genuinely
searches: those phrases became _true_, and the pattern that existed to catch fabricated
retrieval claims started rejecting honest ones. The forbidden list now targets what still
matters — offering the junk a search turned up as a substitute, and narrating the search to a
shopper — and `toolCalled` is unasserted, because declining a flight with or without a search
is equally correct. Retrieval-before-declining is guaranteed where it actually matters, by the
three `false-decline-*` scenarios.

## What the retrieval counts fixed

`resolveProducts` used to return `ProductCard[]` capped at `MAX_RESULTS = 6`, and
`resultCount` was the post-slice length. The model had no way to tell a complete list from
the first six of many, or to know what a `categorySlug` had hidden — so every count and every
completeness claim it wrote was the only number it had, not the true one. That is not a
prompt problem; the honest answer did not exist in its input.

`resolveProductsWithTotals` now returns four counts alongside the cards:

| Count                               | Answers                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `totalMatched`                      | how many met every criterion, before the cap           |
| `remainingAfterThisPage`            | how many matched but did not fit on this page          |
| `totalInCategory`                   | how many the category holds, ignoring search terms     |
| `totalMatchedWithoutCategoryFilter` | how many would have matched without the `categorySlug` |

`remainingAfterThisPage` is required rather than optional, because `0` is a meaningful answer
— "that is all of them" — and an absent field would read as "unknown", which it never is.

`resolveProducts` is unchanged — it is now a one-line wrapper returning `.products`, so all
25 existing call sites and every offline assertion kept working untouched.

Three scenarios went green:

- **`truncation-completeness-follow-up`** — _"There are more: 17 products matched, and I only
  showed 6. So this is not the complete list."_ Previously: _"That's the full list I'm
  seeing… there aren't any hidden pages from this search."_
- **`truncation-invented-inventory-count`** — `totalInCategory` separates stock from cards.
  The old failure counted 4 cards and reported 4 as the inventory; there are 5.
- **`gendered-slug-false-scarcity`** — the false catalog-wide claim is now contradicted by the
  model's own tool result.

A fourth followed later, and it is the one that shows `totalMatched` alone was not enough:

- **`pagination-remaining-count-honest`** — after "show me smartphones" then "show me more",
  roughly half of page-two replies claimed _"there are 10 more matching smartphones not shown
  yet"_. Of 16 smartphones, 12 were on screen and 4 remained. `totalMatched` on page two really
  is 10, because `excludeProductIds` removed page one — **but 6 of those 10 are the cards being
  displayed right now.** The remainder was a subtraction the model had to perform, and it was
  not reliable at it. `remainingAfterThisPage` states the 4 outright.

### The ablation for `remainingAfterThisPage`

Measured in the order the counts work established: ship the structure alone, measure, and only
then consider prose. Three runs per variant, over the new scenario plus the three it could
disturb:

| Variant                       | `pagination-remaining-count-honest` | `show-me-more-pagination` | `truncation-completeness-follow-up` | `truncation-invented-inventory-count` |
| ----------------------------- | ----------------------------------- | ------------------------- | ----------------------------------- | ------------------------------------- |
| Field alone, no prompt text   | **2/3**                             | 3/3                       | 3/3                                 | 3/3                                   |
| **Field + one clause (kept)** | **3/3**                             | 3/3                       | 3/3                                 | 3/3                                   |

**The structure fixed the falsehood; the prose only fixed the silence.** Across all six runs in
both variants the overstatement never recurred once — the field alone was sufficient to stop the
agent making a false inventory claim. What the field alone did not do was make the agent
reliably state the number at all: the single failing run made _no_ count claim, which is safe
but is not a regression guard.

Why one clause was needed is the reusable part. "How many there are" is an **enumeration** of
which counts license a claim, so a count absent from that list reads as one that does not
license anything. Adding a fourth count without naming it there left it visible but unsanctioned.
The fix was extending the existing sentence, not adding a paragraph.

Read the 2/3 as weak on its own — one run in three is the noise floor elsewhere in this suite —
but it agrees with the mechanism, which is why the clause stayed.

**Truncation also gained deterministic offline coverage it could not previously have.** The
fixture's largest category holds 3 products, under the cap of 6, so truncation was
unreachable from a category search. `totalMatched` makes it directly assertable: an
unfiltered whole-catalog call returns 6 cards and `totalMatched: 26`. Same for the count gap
— search terms that fail to score leave zero cards while `totalInCategory` still reports 3.

A partial win worth noting even though its scenario stays red: on `zero-sentinel-empties-catalog`
the reply improved from _"I couldn't pull any grocery items"_ to _"there are 27 grocery items
in the catalog"_. `totalInCategory` gives a true number even when the poisoned search returns
nothing. The scenario still fails, correctly — zero products came back.

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
| `scenarios.json`   | The golden dataset — 27 scenarios, plan and selection expectations |
| `types.ts`         | Zod schemas and types for the dataset                              |
| `scenarios.ts`     | Loads and validates the dataset; normalizes the fixture catalog    |
| `eval-offline.ts`  | Deterministic runner over `resolveProducts`                        |
| `eval-online.ts`   | Live-model runner asserting the plan                               |
| `spend-cap.ts`     | Token accounting and the hard budget ceiling                       |
| `report.ts`        | The catches/misses summary both runners print                      |
| `vitest.config.ts` | Eval-only vitest config (keeps the online suite out of `npm test`) |
