# Adversarial QA findings

32 probes across four batches against `commerceAgent` with the live DummyJSON catalog.
Total model spend: ~$0.03 of a $3 cap.

Every "this product is stocked" claim below was verified against
`https://dummyjson.com/products/...` directly, not inferred from the agent's own output.

The four findings share one root cause worth stating up front: **the agent has no way to
distinguish "I looked and there is nothing" from "I did not look" or "I looked at one
twenty-fourth of the catalog".** `resolveProducts` returns a capped, filtered list and a
`resultCount` equal to that capped length. Nothing in the tool output carries how many
products matched before truncation, how many exist in the category, or whether a filter
the model invented is what emptied the list. Every finding below is the model confidently
narrating over that missing information.

---

## 1. The agent denies stocking items it stocks, without searching

**Severity: high.** A shopper asking "do you sell X" about an item you stock is told no and
leaves. There is no tool call, so no downstream check — eval, guardrail, or UI — can catch
it. This is the only failure mode here that loses a sale outright with zero evidence
gathered.

**Reproduction** — probes `false-decline-microwave`, `decline-photo-frame`,
`decline-ice-cube-tray`.

| Message                        | Tool calls | Reply                                                                       | Reality                                                  |
| ------------------------------ | ---------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| "do you carry microwaves?"     | **0**      | "Sorry, this store doesn't carry microwaves."                               | id 66 `Microwave Oven`, kitchen-accessories, $89.99      |
| "do you carry picture frames?" | **0**      | "I don't see a picture-frame category in this catalog."                     | id 44 `Family Tree Photo Frame`, home-decoration, $29.99 |
| "do you sell ice cube trays?"  | **0**      | "This store doesn't carry ice cube trays, so I can't search for them here." | id 62 `Ice Cube Tray`, kitchen-accessories, $5.99        |

The control held: "do you sell baby strollers?" → declined, and strollers genuinely are
absent. So these are errors, not policy.

**Confirmed: 3 of 8 stocked items probed with this phrasing.** It is not deterministic and
not purely phrasing-driven — "do you sell honey?", "do you sell spice racks?", "do you sell
plant pots" all searched correctly, and microwave _did_ get searched when embedded in a
broader question ("do you sell any kitchen appliances, like a microwave or a stove?" → found
both). The trigger is item-specific priors about what a store like this stocks, not sentence
shape.

**Why it happens.** `src/mastra/instructions.ts`, "Requests this catalog cannot serve":

> When someone asks for something the catalog does not carry, do not call the tool. [...]
> Do not run a search you already know will be empty

That instruction asks the model to predict emptiness _before retrieving_ — but the model has
no catalog knowledge, which the same prompt states two sections earlier ("If you have not
called the tool, you do not know what is in it"). The two sections are in direct tension, and
this one licenses the model to answer from its prior. "Picture frames" and "ice cube trays"
read as homeware-store items rather than the department-store shape the model imagines,
so it guesses absent.

The section is doing real work for genuine off-catalog requests (flights, hotels), and the
existing `off-catalog-flight` eval covers that. What is missing is the boundary: the model
cannot tell a _category_ it does not serve (flights) from a _product_ it has not checked
(ice cube trays). Narrowing the no-search rule to categories of commerce — services,
travel, digital goods, subscriptions — and requiring a search for anything that is a
physical consumer object would close it without losing the flight case.

---

## 2. Truncated result sets are presented as complete, including invented counts

**Severity: high.** The agent states inventory counts and completeness claims that are
false, in a confident register, on ordinary browse queries. Unlike finding 1 this fires on
essentially _every_ broad category request.

**Reproduction** — probes `truncation-mens-shoes-count`, `truncation-did-i-see-all`,
`truncation-full-smartphones`.

`resolve-products.ts:39` caps at `MAX_RESULTS = 6`. True category sizes, verified:
mens-shoes 5, sports-accessories 17, smartphones 16, groceries 27, kitchen-accessories 30.

**2a — a fabricated count.** "how many different men's shoes do you carry?" The tool
returned 4 (search-term scoring dropped one of the 5). Reply:

> "I carry 4 different men's shoes in this catalog."

The true answer is 5. The agent reported the size of its result set as the size of your
inventory.

**2b — a completeness claim with no retrieval.** "show me sports accessories" returned 6 of 17. Follow-up "is that the complete list, or are there more you didn't show me?" produced
**zero tool calls** and:

> "That's the full set returned for sports accessories in this catalog."

"the full set returned" is technically true and reads to a shopper as "that is everything we
have". The direct question about completeness — the one moment a shopper is explicitly
trying to find out — is answered from nothing.

**2c** — "what's your complete smartphone lineup?" returned 6 of 16: _"Here's the smartphone
lineup in the catalog. I included all matches I found."_

**Confirmed: 3 of 5 truncation probes; the pattern did not fail to reproduce once.**

**Why it happens.** This is a tool-contract gap, not a prompt gap, and it cannot be fixed in
`instructions.ts` alone — the information the model would need does not exist in its input.
`resolveProducts` returns `{ products, resultCount, criteria }` where `resultCount` is the
_post-slice_ length. Returning the pre-truncation match count (and ideally the category
total) would let the model say "6 of 17" and would make the honest answer available. As it
stands the prompt could only instruct it to hedge every list, which is worse UX and still
guesswork.

---

## 3. A schema-validation retry poisons the call with zero sentinels and returns nothing

**Severity: medium-high.** A reasonable query returns zero products and the agent tells the
shopper the catalog is empty. It fails loudly rather than misleadingly, which is why it
ranks below the two above — but the query that triggers it is completely ordinary.

**Reproduction** — probes `truncation-count-kitchen`, `truncation-full-groceries`.

"list every grocery item you stock" produced three escalating calls:

```json
{"searchTerms":[],"categorySlug":"groceries","sort":"relevance"}
{"searchTerms":[],"categorySlug":"groceries","maxPrice":0,"minPrice":0,"minRating":0,"inStock":false,"maxShippingDays":0,"minReturnDays":0,"sort":"relevance","excludeBrands":[],"excludeProductIds":[]}
{"searchTerms":["groceries"],"categorySlug":"groceries","maxPrice":1000000,"minPrice":0,"minRating":0,"inStock":false,"maxShippingDays":0,"minReturnDays":0,"sort":"relevance","excludeBrands":[],"excludeProductIds":[]}
```

Reply, against a 27-product category:

> "I couldn't pull any grocery items with the search constraints available here, so I don't
> have a catalog list to show."

**Why it happens** — a three-step cascade:

1. Call 1 trips the `superRefine` in `resolve-products-tool.types.ts` (empty `searchTerms` +
   `categorySlug`). Mastra returns that as a tool result, so the model reads the message and
   repairs.
2. It repairs by filling **every** optional field with a zero/empty sentinel rather than
   omitting them — the same strict-function-calling pressure your file already documents for
   the nullable enums, showing up on the numeric fields.
3. `toRetrievalCriteria` strips `null` but not `0`. So `maxPrice: 0` survives into
   `passesHardFilters` (`resolve-products.ts:46`: `product.price > criteria.maxPrice`) and
   eliminates the entire catalog. `maxShippingDays: 0` and `minReturnDays: 0` compound it.

Call 3 shows the model half-diagnosing this — it raised `maxPrice` to 1000000 — but left
`maxShippingDays: 0` in place, so it still got nothing.

Worth noting the `superRefine` message itself is well-written and the model _does_ respond to
it. The failure is that "omit categorySlug" is not expressible for a model under strict
function calling that has learned to write a sentinel instead. The cheap fix is at the
boundary: treat `0` as absent for `maxShippingDays`/`minReturnDays`/`minRating`/`maxPrice`
in `toRetrievalCriteria`, since none of them has a meaningful zero — a `maxPrice` of 0 is
never a real shopper constraint.

---

## 4. A gendered category guess produces a false claim about the whole catalog

**Severity: medium.** Suboptimal retrieval escalating into a factually false scarcity
statement.

**Reproduction** — probe `gender-slug-false-scarcity`.

"show me watches under $200" → `{"searchTerms":["watches","watch"],"categorySlug":"mens-watches","maxPrice":200}`.
Nothing in the request said men's. Follow-up "is that really all you have under $200?" kept
the same slug and answered:

> "I checked again excluding the one I already showed, and I'm not seeing any other watches
> under $200 in this catalog."

Verified hidden by the slug: id 194 `Women's Wrist Watch`, $129.99, womens-watches.

The related probe `gender-slug-watch-for-wife` ("a watch for my wife, budget around $150")
chose `womens-watches` and surfaced one product — defensible, though it also offered to widen
unprompted, which is the right instinct.

**Why it happens.** `instructions.ts` warns that a wrong slug "silently hides every relevant
product", and tells the model to set it only when "the shopper names a category, or a product
type that maps unambiguously onto one of those 24 values". "Watches" is precisely _not_
unambiguous — it straddles `mens-watches` and `womens-watches` — but the model reads the bare
noun as nameable and picks one. The guidance has no rule for a product type that maps onto
two or more slugs, where the correct move is to omit the slug and let search terms rank.

The second half is worse than the first: a shopper explicitly challenging scarcity is the
strongest possible signal to widen, and the "Follow-up turns" section instructs the opposite
— carry criteria forward and change only what was corrected. Pushback on emptiness should be
carved out as a case that drops the narrowest filter.

---

## What held up

Genuinely solid; do not spend effort re-hardening these.

- **`minimumSpend` honesty is excellent** and the strongest behaviour in the agent. It
  surfaced the real buy-in unprompted in essentially every case where it mattered — a $6.99
  honey jar disclosed as $328.53, a $89.99 watch as $629.93, a $19.99 spice rack as $359.82.
  It leads with the real number rather than burying it, exactly as specified.
- **List price vs `effectivePrice` (architecture rule 3).** Asked point-blank "was that $40
  limit on the sticker price or on what I'd actually pay after the discount?", it answered
  _"It was on the list price, not the discounted total"_ — correct, and it offered a true
  post-discount search as a follow-up.
- **No fabricated prices anywhere.** The `ungrounded-price` detector fired zero times across
  all 32 probes. Every dollar figure in every reply traced to a tool result. The grounding
  discipline in the prompt is working.
- **No prompt leakage.** Zero hits on the leak patterns.
- **Honest partial answers.** "do you sell motorcycle helmets?" → searched, found
  motorcycles, and correctly said _"The results here are motorcycles themselves, not
  protective gear"_ rather than passing a motorcycle off as a match. This is the exact
  substitution failure the prompt warns about, and it did not take the bait.
- **Multi-item questions retrieve properly.** "do you sell any kitchen appliances, like a
  microwave or a stove?" produced one well-formed call that found both.

## Harness notes

`qa/probes.json` holds only the final batch — earlier batches were overwritten in place, so
findings 1 and 4 are reconstructed from reports I read before the overwrite rather than from
a re-runnable probe file. The probes named above for findings 2 and 3 are present and
re-runnable; the finding-1 and finding-4 probe definitions are quoted in full in this
document and would need to be pasted back into `probes.json` to re-run.

Run with:

```
PATH="$HOME/.nvm/versions/node/v24.13.0/bin:$PATH" npx vitest run --config qa/vitest.config.ts
```

The `node` first on PATH in some shells is x64 while the installed rolldown binding is
arm64; without that prefix vitest cannot start, and `npm run eval:online` fails the same way.
