import { afterAll, describe, expect, it } from 'vitest';
import { resolveProducts } from '@/catalog/resolve-products';
import type { ProductCard, RetrievalCriteria } from '@/catalog/types';
import { formatOfflineReport } from './report';
import { offlineCatalog, scenarios, scenariosWithOfflineCoverage } from './scenarios';
import type { OfflineCall, OfflineCallExpectation, OfflineCheck } from './types';

// Why plain vitest and not Mastra scorers
// --------------------------------------
// Scorers are built for LLM-judge grading and a playground UI. A golden dataset over a
// fixed 194-product catalog is not a grading problem — it is a deterministic assertion
// problem, and every question worth asking here ("does the $419.99 Galaxy survive a
// maxPrice of 400?") has exactly one correct answer that a judge model could only get
// wrong. Vitest gives us that answer for free, at zero API cost, in the same runner and
// the same reporter as the other 136 tests. The online half below still needs the real
// model, but it asserts the plan, which is also deterministic enough to assert directly.

describe('offline eval — deterministic retrieval over the fixture catalog', () => {
  it('loads every scenario in the golden dataset', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(15);
  });

  describe.each(scenariosWithOfflineCoverage())('$id', (scenario) => {
    const offline: OfflineCheck | undefined = scenario.offline;
    if (offline === undefined) {
      throw new Error(`Scenario claimed offline coverage but carries none (id: ${scenario.id})`);
    }

    const resultsByCall = runCalls(offline.calls);

    it.each(offline.calls.map((call, index) => ({ call, index })))(
      'call: $call.label',
      ({ call, index }) => {
        assertCallExpectation(call.expect, resultsByCall[index], `${scenario.id}/${call.label}`);
      },
    );

    if (offline.expect?.callsDisjoint === true) {
      it('returns non-overlapping result sets across calls', () => {
        expect(collectDuplicateIds(resultsByCall), scenario.offline?.note).toEqual([]);
      });
    }

    if (offline.expect?.laterCallReturnsFewer === true) {
      it('narrows the result set with each successive call', () => {
        const counts = resultsByCall.map((results) => results.length);
        for (let index = 1; index < counts.length; index += 1) {
          expect(counts[index], `${scenario.id}: call ${index} did not narrow`).toBeLessThan(
            counts[index - 1],
          );
        }
      });
    }
  });
});

afterAll(() => {
  process.stdout.write(formatOfflineReport());
});

function runCalls(calls: OfflineCall[]): ProductCard[][] {
  const resultsByCall: ProductCard[][] = [];
  for (const call of calls) {
    const previousResults = resultsByCall[resultsByCall.length - 1] ?? [];
    const criteria = withCarriedExclusions(call, previousResults);
    resultsByCall.push(resolveProducts(criteria, offlineCatalog));
  }

  return resultsByCall;
}

function withCarriedExclusions(call: OfflineCall, previous: ProductCard[]): RetrievalCriteria {
  if (call.excludeIdsFromPreviousCall !== true) {
    return call.criteria;
  }

  const alreadyExcluded = call.criteria.excludeProductIds ?? [];
  const previouslyShown = previous.map((product) => product.id);

  return { ...call.criteria, excludeProductIds: [...alreadyExcluded, ...previouslyShown] };
}

function assertCallExpectation(
  expectation: OfflineCallExpectation | undefined,
  results: ProductCard[],
  label: string,
): void {
  if (expectation === undefined) {
    return;
  }

  const ids = results.map((product) => product.id);

  if (expectation.productIds !== undefined) {
    expect(sorted(ids), `${label}: exact result set`).toEqual(sorted(expectation.productIds));
  }
  if (expectation.includesProductIds !== undefined) {
    expect(ids, `${label}: missing an expected product`).toEqual(
      expect.arrayContaining(expectation.includesProductIds),
    );
  }
  if (expectation.excludesProductIds !== undefined) {
    const leaked = expectation.excludesProductIds.filter((id) => ids.includes(id));
    expect(leaked, `${label}: excluded products came back`).toEqual([]);
  }
  const allowedIds = expectation.subsetOfProductIds;
  if (allowedIds !== undefined) {
    const unexpected = ids.filter((id) => !allowedIds.includes(id));
    expect(unexpected, `${label}: unexpected products in the result set`).toEqual([]);
  }
  if (expectation.nonEmpty === true) {
    expect(results.length, `${label}: expected at least one result`).toBeGreaterThan(0);
  }
  if (expectation.empty === true) {
    expect(ids, `${label}: expected no results at all`).toEqual([]);
  }
  const priceCeiling = expectation.everyPriceAtMost;
  if (priceCeiling !== undefined) {
    const overBudget = results.filter((product) => product.price > priceCeiling);
    expect(
      overBudget.map((product) => product.id),
      `${label}: over the price ceiling`,
    ).toEqual([]);
  }

  const ratingFloor = expectation.everyRatingAtLeast;
  if (ratingFloor !== undefined) {
    const underRated = results.filter((product) => product.rating < ratingFloor);
    expect(
      underRated.map((product) => product.id),
      `${label}: under the rating floor`,
    ).toEqual([]);
  }

  assertProductFacts(expectation, results, label);
}

function assertProductFacts(
  expectation: OfflineCallExpectation,
  results: ProductCard[],
  label: string,
): void {
  for (const fact of expectation.productFacts ?? []) {
    const product = results.find((candidate) => candidate.id === fact.id);
    if (product === undefined) {
      throw new Error(
        `${label}: expected product ${fact.id} in the result set (got: ${results.map((entry) => entry.id).join(', ')})`,
      );
    }

    if (fact.price !== undefined) {
      expect(product.price, `${label}: product ${fact.id} price`).toBe(fact.price);
    }
    if (fact.minimumOrderQuantity !== undefined) {
      expect(
        product.minimumOrderQuantity,
        `${label}: product ${fact.id} minimumOrderQuantity`,
      ).toBe(fact.minimumOrderQuantity);
    }
    if (fact.minimumSpend !== undefined) {
      expect(product.minimumSpend, `${label}: product ${fact.id} minimumSpend`).toBe(
        fact.minimumSpend,
      );
    }
  }
}

function collectDuplicateIds(resultsByCall: ProductCard[][]): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const results of resultsByCall) {
    for (const product of results) {
      if (seen.has(product.id)) {
        duplicates.add(product.id);
      }
      seen.add(product.id);
    }
  }

  return sorted([...duplicates]);
}

function sorted(ids: number[]): number[] {
  return [...ids].sort((left, right) => left - right);
}
