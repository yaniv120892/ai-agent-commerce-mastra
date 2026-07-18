import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductCard, RetrievalCriteria } from '@/catalog/types';
import { productCardSchema, retrievalCriteriaSchema } from '@/catalog/types';
import { formatOnlineReport } from './report';
import { scenarios } from './scenarios';
import { SpendCap } from './spend-cap';
import type { CriteriaExpectation, EvalScenario } from './types';

// This half asserts the PLAN, not the prose. Wording from a live model is not
// reproducible, so the only prose assertions here are negative — a short list of
// phrases that would amount to a fabricated retrieval claim — plus one loose
// positive check that a vague request disclosed its assumptions at all.

type CommerceAgent = (typeof import('@/mastra/agent'))['commerceAgent'];

type TurnOutcome = {
  text: string;
  criteriaPerCall: RetrievalCriteria[];
  products: ProductCard[];
};

const EVAL_RESOURCE_ID = 'eval-online';
const RESOLVE_PRODUCTS_TOOL_NAME = 'resolveProducts';
const MAX_STEPS_PER_TURN = 6;

const spendCap = new SpendCap(process.env);
const runId = Date.now();

let agent: CommerceAgent | null = null;
let executedScenarios = 0;

describe('online eval — the real planner against the live catalog', () => {
  beforeAll(async () => {
    loadEnvFileIfPresent();
    assertApiKeyPresent();
    agent = (await import('@/mastra/agent')).commerceAgent;
  });

  afterAll(() => {
    process.stdout.write(formatOnlineReport(spendCap.summary(), executedScenarios));
  });

  it.each(scenarios.map((scenario) => ({ scenario, id: scenario.id })))(
    '$id',
    async ({ scenario }) => {
      const threadId = `eval-${scenario.id}-${runId}`;
      const previouslyShownIds = await runPriorTurns(scenario, threadId);
      const outcome = await runTurn(scenario.query, threadId);
      executedScenarios += 1;

      assertToolUsage(scenario, outcome);
      assertCriteria(scenario, outcome, previouslyShownIds);
      assertToolResults(scenario, outcome);
      assertReplyText(scenario, outcome);
    },
  );
});

async function runPriorTurns(scenario: EvalScenario, threadId: string): Promise<number[]> {
  const shownIds: number[] = [];
  for (const priorMessage of scenario.priorMessages ?? []) {
    const outcome = await runTurn(priorMessage, threadId);
    shownIds.push(...outcome.products.map((product) => product.id));
  }

  return [...new Set(shownIds)];
}

async function runTurn(query: string, threadId: string): Promise<TurnOutcome> {
  spendCap.assertBudgetRemains();

  const output = await resolveAgent().generate(query, {
    memory: { thread: threadId, resource: EVAL_RESOURCE_ID },
    maxSteps: MAX_STEPS_PER_TURN,
  });
  spendCap.record(output.totalUsage);

  return {
    text: output.text,
    criteriaPerCall: readCriteriaPerCall(output.toolCalls),
    products: readProducts(output.toolResults),
  };
}

function assertToolUsage(scenario: EvalScenario, outcome: TurnOutcome): void {
  const callCount = outcome.criteriaPerCall.length;

  if (!scenario.expect.toolCalled) {
    expect(
      callCount,
      `${scenario.id}: expected no retrieval at all, but the tool ran. Reply: ${outcome.text}`,
    ).toBe(0);

    return;
  }

  expect(callCount, `${scenario.id}: expected a tool call. Reply: ${outcome.text}`).toBeGreaterThan(
    0,
  );

  const expectedCount = scenario.expect.toolCallCount;
  if (expectedCount !== undefined) {
    expect(
      callCount,
      `${scenario.id}: expected ${expectedCount} tool call(s), got ${callCount}. Reply: ${outcome.text}`,
    ).toBe(expectedCount);
  }
}

function assertCriteria(
  scenario: EvalScenario,
  outcome: TurnOutcome,
  previouslyShownIds: number[],
): void {
  const expectation = scenario.expect.criteria;
  if (expectation !== undefined) {
    const mismatchesPerCall = outcome.criteriaPerCall.map((criteria) =>
      collectCriteriaMismatches(expectation, criteria, previouslyShownIds),
    );
    const satisfied = mismatchesPerCall.some((mismatches) => mismatches.length === 0);

    expect(
      satisfied,
      `${scenario.id}: no tool call matched the expected criteria. ${describeMismatches(mismatchesPerCall, outcome)}`,
    ).toBe(true);
  }

  assertCriteriaPerCall(scenario, outcome, previouslyShownIds);
}

function assertCriteriaPerCall(
  scenario: EvalScenario,
  outcome: TurnOutcome,
  previouslyShownIds: number[],
): void {
  const expectations = scenario.expect.criteriaPerCall;
  if (expectations === undefined) {
    return;
  }

  const unmatchedCalls = [...outcome.criteriaPerCall];
  for (const expectation of expectations) {
    const matchIndex = unmatchedCalls.findIndex(
      (criteria) =>
        collectCriteriaMismatches(expectation, criteria, previouslyShownIds).length === 0,
    );

    expect(
      matchIndex,
      `${scenario.id}: no remaining tool call satisfied ${JSON.stringify(expectation)}. Calls: ${JSON.stringify(outcome.criteriaPerCall)}`,
    ).toBeGreaterThanOrEqual(0);
    unmatchedCalls.splice(matchIndex, 1);
  }
}

function assertToolResults(scenario: EvalScenario, outcome: TurnOutcome): void {
  const expectation = scenario.expect.toolResults;
  if (expectation === undefined) {
    return;
  }

  const total = outcome.products.length;
  if (expectation.totalProductsEquals !== undefined) {
    expect(total, `${scenario.id}: unexpected product count. Reply: ${outcome.text}`).toBe(
      expectation.totalProductsEquals,
    );
  }
  if (expectation.totalProductsAtLeast !== undefined) {
    expect(
      total,
      `${scenario.id}: too few products came back. Reply: ${outcome.text}`,
    ).toBeGreaterThanOrEqual(expectation.totalProductsAtLeast);
  }
}

function assertReplyText(scenario: EvalScenario, outcome: TurnOutcome): void {
  for (const pattern of scenario.expect.forbidden ?? []) {
    expect(
      new RegExp(pattern, 'i').test(outcome.text),
      `${scenario.id}: reply matched forbidden pattern /${pattern}/i. Reply: ${outcome.text}`,
    ).toBe(false);
  }

  const requiredAnyOf = scenario.expect.requiredAnyOf;
  if (requiredAnyOf === undefined || requiredAnyOf.length === 0) {
    return;
  }

  const matched = requiredAnyOf.some((pattern) => new RegExp(pattern, 'i').test(outcome.text));
  expect(
    matched,
    `${scenario.id}: reply matched none of ${requiredAnyOf.join(', ')}. Reply: ${outcome.text}`,
  ).toBe(true);
}

function collectCriteriaMismatches(
  expectation: CriteriaExpectation,
  criteria: RetrievalCriteria,
  previouslyShownIds: number[],
): string[] {
  const mismatches: string[] = [];

  if (
    expectation.categorySlug !== undefined &&
    criteria.categorySlug !== expectation.categorySlug
  ) {
    mismatches.push(`categorySlug ${criteria.categorySlug} !== ${expectation.categorySlug}`);
  }
  if (
    expectation.maxPriceAtMost !== undefined &&
    (criteria.maxPrice === undefined || criteria.maxPrice > expectation.maxPriceAtMost)
  ) {
    mismatches.push(`maxPrice ${criteria.maxPrice} is not <= ${expectation.maxPriceAtMost}`);
  }
  if (
    expectation.minPriceAtLeast !== undefined &&
    (criteria.minPrice === undefined || criteria.minPrice < expectation.minPriceAtLeast)
  ) {
    mismatches.push(`minPrice ${criteria.minPrice} is not >= ${expectation.minPriceAtLeast}`);
  }
  if (
    expectation.minRatingEquals !== undefined &&
    criteria.minRating !== expectation.minRatingEquals
  ) {
    mismatches.push(`minRating ${criteria.minRating} !== ${expectation.minRatingEquals}`);
  }
  if (expectation.inStock !== undefined && criteria.inStock !== expectation.inStock) {
    mismatches.push(`inStock ${criteria.inStock} !== ${expectation.inStock}`);
  }
  if (
    expectation.searchTermsIncludeAnyOf !== undefined &&
    !matchesAnyTerm(criteria.searchTerms, expectation.searchTermsIncludeAnyOf)
  ) {
    mismatches.push(
      `searchTerms ${JSON.stringify(criteria.searchTerms)} include none of ${expectation.searchTermsIncludeAnyOf.join(', ')}`,
    );
  }
  if (
    expectation.searchTermsEmpty !== undefined &&
    (criteria.searchTerms.length === 0) !== expectation.searchTermsEmpty
  ) {
    mismatches.push(
      `searchTerms ${JSON.stringify(criteria.searchTerms)} is ${criteria.searchTerms.length === 0 ? '' : 'not '}empty, expected ${expectation.searchTermsEmpty ? '' : 'not '}empty`,
    );
  }
  if (
    expectation.excludeBrandsMatchAnyOf !== undefined &&
    !matchesAnyTerm(criteria.excludeBrands ?? [], expectation.excludeBrandsMatchAnyOf)
  ) {
    mismatches.push(
      `excludeBrands ${JSON.stringify(criteria.excludeBrands)} match none of ${expectation.excludeBrandsMatchAnyOf.join(', ')}`,
    );
  }
  if (expectation.excludesPreviouslyShownIds === true) {
    const excluded = criteria.excludeProductIds ?? [];
    const missing = previouslyShownIds.filter((id) => !excluded.includes(id));
    if (previouslyShownIds.length === 0 || missing.length > 0) {
      mismatches.push(
        `excludeProductIds ${JSON.stringify(excluded)} omits already-shown ids ${JSON.stringify(missing)}`,
      );
    }
  }

  for (const field of expectation.requiredFields ?? []) {
    if (criteria[field] === undefined) {
      mismatches.push(`required field ${field} was not set`);
    }
  }
  for (const field of expectation.forbiddenFields ?? []) {
    if (criteria[field] !== undefined) {
      mismatches.push(`forbidden field ${field} was set to ${JSON.stringify(criteria[field])}`);
    }
  }

  return mismatches;
}

function matchesAnyTerm(actualTerms: string[], expectedTerms: string[]): boolean {
  return expectedTerms.some((expectedTerm) =>
    actualTerms.some((actualTerm) => actualTerm.toLowerCase().includes(expectedTerm.toLowerCase())),
  );
}

function describeMismatches(mismatchesPerCall: string[][], outcome: TurnOutcome): string {
  const perCall = mismatchesPerCall.map(
    (mismatches, index) => `call ${index}: ${mismatches.join('; ')}`,
  );

  return `${perCall.join(' | ')}. Calls: ${JSON.stringify(outcome.criteriaPerCall)}`;
}

function readCriteriaPerCall(toolCalls: unknown): RetrievalCriteria[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const criteriaPerCall: RetrievalCriteria[] = [];
  for (const toolCall of toolCalls) {
    const payload = readPayload(toolCall);
    if (payload === null || Reflect.get(payload, 'toolName') !== RESOLVE_PRODUCTS_TOOL_NAME) {
      continue;
    }

    const parsed = retrievalCriteriaSchema.safeParse(
      withoutNullFields(Reflect.get(payload, 'args')),
    );
    if (parsed.success) {
      criteriaPerCall.push(parsed.data);
    }
  }

  return criteriaPerCall;
}

function readProducts(toolResults: unknown): ProductCard[] {
  if (!Array.isArray(toolResults)) {
    return [];
  }

  const products: ProductCard[] = [];
  for (const toolResult of toolResults) {
    const payload = readPayload(toolResult);
    if (payload === null || Reflect.get(payload, 'toolName') !== RESOLVE_PRODUCTS_TOOL_NAME) {
      continue;
    }

    // Only the products are read, not the whole tool output: the output echoes the
    // criteria back, and those carry the model's nulls.
    const result: unknown = Reflect.get(payload, 'result');
    if (typeof result !== 'object' || result === null) {
      continue;
    }

    const parsed = productCardSchema.array().safeParse(Reflect.get(result, 'products'));
    if (parsed.success) {
      products.push(...parsed.data);
    }
  }

  return products;
}

// The model emits `"maxPrice": null` for every optional field it chose not to set, and
// zod's `.optional()` rejects null outright. Left in place, every tool call fails to parse
// and the eval reports "no tool call" for a turn that plainly made one.
function withoutNullFields(toolCallArguments: unknown): unknown {
  if (typeof toolCallArguments !== 'object' || toolCallArguments === null) {
    return toolCallArguments;
  }

  const populated: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(toolCallArguments)) {
    if (value !== null) {
      populated[field] = value;
    }
  }

  return populated;
}

function readPayload(chunk: unknown): object | null {
  if (typeof chunk !== 'object' || chunk === null) {
    return null;
  }

  const payload: unknown = Reflect.get(chunk, 'payload');
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  return payload;
}

function resolveAgent(): CommerceAgent {
  if (agent === null) {
    throw new Error('The commerce agent was not initialised before a turn was requested');
  }

  return agent;
}

function loadEnvFileIfPresent(): void {
  const envFilePath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  process.loadEnvFile(envFilePath);
}

function assertApiKeyPresent(): void {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey !== undefined && apiKey.trim().length > 0 && apiKey !== 'sk-your-key-here') {
    return;
  }

  throw new Error(
    'The online eval needs a real OPENAI_API_KEY. Export it, or run from a checkout whose .env holds one, then re-run `npm run eval:online`. It is deliberately not part of `npm test` and it deliberately does not fall back to a placeholder — a skipped online run must never look like a passing one.',
  );
}
