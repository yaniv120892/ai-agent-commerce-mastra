# Retrieval design — the long form

The README summarises retrieval in section 3 and links here for the mechanics. This file holds
the parts a reader only wants once they have decided the summary is worth interrogating: the
exact scoring function, the normalization layer, and the discount decision.

Source: `src/catalog/resolve-products.ts`, `src/catalog/normalize.ts`.
Measurements behind it: `docs/api-findings.md`.

---

## The ranking algorithm

Hard filters first (category, price range, rating, stock, shipping days, return days), then
lexical scoring over what survives, then sort, then exclusions, then a cap of 6.

Exclusions run **after** sorting but **before** the cap, so excluding a product promotes the
seventh-ranked item into view rather than leaving a hole.

Scoring is weighted token overlap, scaled by query coverage:

```
score = Σ(field weight × match quality) × (0.25 + 0.75 × matchedTerms / totalTerms)
```

Field weights are title 10, tags 6, brand 4, description 2. An exact whole-title match
short-circuits to 1000. Tokens are lowercased, split on non-alphanumerics, and naively
singularized so "laptops" and "laptop" collide.

Ties break on score, then rating, then id. The id tie-break is what makes identical criteria
produce identical output, which is what lets the offline golden dataset assert exact result
sets at all.

**On the constants.** The 4-character floor was derived from a real defect (below). The weight
ordering is reasoned — title is the most precise field, brand is sparse and therefore weak
evidence — but the magnitudes 10/6/4/2 and the 0.25 coverage floor were chosen, not tuned
against a labelled relevance set. That set is what I would build before touching them.

### Coverage scaling solves the grocery-apple trap

Query `["apple", "laptop", "tablet", "smartphone"]`: the $1.99 Grocery Apple scores a strong
exact hit on its title — it genuinely is called "Apple" — but it covers 1 of 4 terms, so its
total is multiplied by 0.4375, and it lands below the MacBook, the iPad, and the iPhone, which
each cover two.

**Breadth beats depth**, which is exactly the right instinct for a shopping query. It is pinned
by a test that asserts the _ordering_ rather than merely asserting relevance.

### Why the prompt asks for short terms

Because terms are scored independently and scaled by coverage, the system prompt and the tool
description both instruct the model to emit several short specific terms
(`["laptop", "apple", "macbook"]`) rather than one long phrase (`["apple laptop for work"]`).

The mechanism is sharper than "the prompt says so". `normalizeSearchTerms` flat-maps
tokenization over the model's terms, so the coverage **denominator is tokens, not array
entries**. `["apple laptop for work"]` becomes four tokens including `for`, which matches
nothing — so the phrase is penalised twice: no phrase bonus, plus dilution by filler. The
prompt describes the actual scoring function, so the model's incentives and the retriever's
behaviour agree.

### The 4-character floor is load-bearing

Substring matching is allowed only when both the term and the token are at least 4 characters.

At 3, `"beauty"` contains `"eau"`, so a search for _beauty_ surfaced **Gucci Bloom Eau de
Parfum** — a fragrance, from the wrong category, ranked on a nonsense match. A test caught
that, not inspection, and the regression test now asserts every result of a `beauty` search is
actually in the `beauty` category.

The same floor applies to brand exclusion, for the same reason and after the same class of
defect: unbounded substring matching meant `excludeBrands: ["le"]` silently removed Eyeshadow
Pa**le**tte, Calvin K**le**in, App**le**, Attitude Super **Le**aves and Ro**le**x. Below the
floor the needle must match a whole token, so a genuinely short brand like `"CK"` still
excludes _Calvin Klein CK One_.

---

## The normalization layer the API cannot give you

The single highest-leverage finding in `docs/api-findings.md`: the logistics fields _look_ like
free text but are **low-cardinality enums** — 6 distinct `shippingInformation` values, 5
`returnPolicy`, 10 `warrantyInformation`, exhaustive across all 194 products.

So `src/catalog/normalize.ts` parses them once at ingest into numbers: `shippingDays`,
`returnDays`, `warrantyMonths` (with `Lifetime warranty` → `Infinity`), plus derived
`effectivePrice` and `minimumSpend`.

That turns "something that ships fast" into `maxShippingDays: 2` and "make sure I can return
it" into `minReturnDays: 30` — exact numeric comparisons over fields the upstream API does not
expose and cannot filter on. **This is the layer you structurally cannot build when you
delegate filtering to someone else's API**, and it is the clearest argument for having moved
retrieval into code.

`NormalizedProduct` is a plain type rather than a zod schema for one specific reason:
`Lifetime warranty` maps to `Infinity`, and zod 4's `z.number()` rejects non-finite values.

### Exhaustive at compile time, permissive at runtime

The mappings are exhaustive `satisfies Record<Enum, number>` objects, so adding an enum value
without deciding its numeric meaning fails to compile. They are then wrapped in a `ReadonlyMap`
for lookup, so an **unrecognised** value at runtime resolves to `undefined` rather than
throwing.

That asymmetry is deliberate, and it replaced a stricter first version. Originally an unknown
value threw and failed the whole catalog fetch. A single new category or shipping string
appearing upstream would then not degrade the catalog, it would **empty** it: the parse threw,
the fetch rejected, the cache never populated, and every search failed — roughly five minutes
after upstream changed, with no deploy involved.

Ingest is now permissive per field, `parseProducts` keeps the valid products and throws only
when **fewer than half** parse (catalog drift versus a genuinely changed API shape), and the
cache retains last-known-good.

### The subtle half

`undefined > 2` is `false`, so a product with an unparseable shipping string could have
**silently passed a `maxShippingDays` bound it was never shown to meet**. Products with unknown
logistics values are therefore excluded while the corresponding filter is active, and included
when it is not.

That is the difference between failing soft and failing wrong.

---

## Discounts, and a decision that turned out not to matter

Every product has a `discountPercentage` (median 11%). I filter on **list price** and display
both prices, because filtering on the discounted price returns products that contradict the
stated query — ask for "under $400" and get a $450 item, which is confusing even when it is
technically cheaper.

Then I checked whether the decision was load-bearing: at a $400 threshold, list price and
discounted price both yield **156 products**. Zero difference.

I kept the rule for its correctness argument and recorded that it changes nothing today, so
nobody re-litigates it later on the assumption that it might.

---

## The four retrieval counts

`resolveProductsWithTotals` returns three counts and a remainder beside the cards, because the
model was previously writing inventory claims from the only number it had — the post-cap card
count.

| Count                               | Answers                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `totalMatched`                      | how many met every criterion, before the cap             |
| `remainingAfterThisPage`            | how many matched but did not fit on this page            |
| `totalInCategory`                   | how many the category holds, ignoring every other filter |
| `totalMatchedWithoutCategoryFilter` | how many would match without the slug                    |

`totalInCategory` deliberately ignores `searchTerms`: it answers "how many of these do you
stock", where a term that failed to score is not evidence of absent inventory. That distinction
is what fixed an agent claiming to carry 4 men's shoes against a true 5.

`remainingAfterThisPage` is **required rather than optional**, because `0` is a meaningful
answer ("that is all of them") and an absent field would read as "unknown", which it never is.

`countMatchedWithoutCategoryFilter` re-runs the pipeline with the category dropped, so a
category-filtered call makes two full passes over 194 products. Cheap here; a real cost at
scale.
