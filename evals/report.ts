import {
  scenarios,
  scenariosWithOfflineCoverage,
  scenariosWithoutOfflineCoverage,
} from './scenarios';

const OFFLINE_CATCHES = [
  'retrieval regressions — a product that should match stops matching',
  'filter regressions — maxPrice, minRating, inStock, categorySlug losing their teeth',
  'ranking regressions — the right product falling out of the top 6',
  'exclusion regressions — excludeProductIds and the excludeBrands title fallback',
  'shape regressions — minimumSpend, effectivePrice and the other derived card fields',
];

const OFFLINE_MISSES = [
  'whether the model calls the tool at all (the YAN-35 multi-intent zero-call failure)',
  'whether it invents criteria nobody asked for (the YAN-35 unrequested minRating 4.5)',
  'whether it declines out-of-catalog requests instead of searching anyway',
  'whether it discloses the assumptions it made on a vague request',
  'whether it obeys an injected instruction in a user message or a product description',
  'whether it fabricates a retrieval claim, a product, or a price in prose',
];

export function formatOfflineReport(): string {
  const covered = scenariosWithOfflineCoverage();
  const uncovered = scenariosWithoutOfflineCoverage();

  return [
    '',
    '─── offline eval — deterministic, no model call, no API spend ───',
    `scenarios in the golden dataset: ${scenarios.length}`,
    `with deterministic offline coverage: ${covered.length}`,
    `plan-only, online can judge them: ${uncovered.length}`,
    '',
    'This half CATCHES:',
    ...OFFLINE_CATCHES.map((line) => `  + ${line}`),
    '',
    'This half CANNOT CATCH — it never calls the model, so no prompt regression is visible to it:',
    ...OFFLINE_MISSES.map((line) => `  - ${line}`),
    '',
    ...formatUncoveredScenarios(),
    'Run `npm run eval:online` for the half that exercises the real planner.',
    '',
  ].join('\n');
}

export function formatOnlineReport(spendSummary: string, executedScenarios: number): string {
  return [
    '',
    '─── online eval — real model calls, real spend ───',
    `scenarios executed against the live model: ${executedScenarios} of ${scenarios.length}`,
    spendSummary,
    '',
    'This half asserts the PLAN, never the prose: was the tool called, how many times,',
    'were the criteria sane, was an out-of-catalog request declined without a search.',
    'Exact wording is non-deterministic and is only ever asserted negatively — a short',
    'list of phrases that would constitute a fabricated retrieval claim.',
    '',
    'It CANNOT CATCH: a retrieval or ranking regression hidden behind a plausible plan.',
    'Run `npm run eval:offline` for the half that pins selection exactly.',
    '',
  ].join('\n');
}

function formatUncoveredScenarios(): string[] {
  const uncovered = scenariosWithoutOfflineCoverage();
  if (uncovered.length === 0) {
    return [];
  }

  return [
    'Scenarios with no deterministic coverage at all:',
    ...uncovered.map((scenario) => `  ${scenario.id}: ${scenario.offlineGap ?? 'online only'}`),
    '',
  ];
}
