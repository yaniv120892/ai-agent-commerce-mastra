import { normalizeProduct } from '@/catalog/normalize';
import { fixtureCatalog } from '@/catalog/__fixtures__/catalog';
import type { NormalizedProduct } from '@/catalog/types';
import scenarioFile from './scenarios.json';
import { evalScenarioFileSchema, type EvalScenario } from './types';

export const scenarios: EvalScenario[] = loadScenarios();

// Offline determinism comes from the 26-product fixture, never the live catalog:
// upstream data can change under us and a golden dataset that moves is not golden.
export const offlineCatalog: NormalizedProduct[] = fixtureCatalog.map(normalizeProduct);

export function scenariosWithOfflineCoverage(): EvalScenario[] {
  return scenarios.filter((scenario) => scenario.offline !== undefined);
}

export function scenariosWithoutOfflineCoverage(): EvalScenario[] {
  return scenarios.filter((scenario) => scenario.offline === undefined);
}

function loadScenarios(): EvalScenario[] {
  const parsed = evalScenarioFileSchema.safeParse(scenarioFile);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`evals/scenarios.json is invalid (${issues.join('; ')})`);
  }

  const duplicateId = findDuplicateId(parsed.data.scenarios);
  if (duplicateId !== null) {
    throw new Error(`evals/scenarios.json has a duplicate scenario id (id: ${duplicateId})`);
  }

  return parsed.data.scenarios;
}

function findDuplicateId(loaded: EvalScenario[]): string | null {
  const seen = new Set<string>();
  for (const scenario of loaded) {
    if (seen.has(scenario.id)) {
      return scenario.id;
    }
    seen.add(scenario.id);
  }

  return null;
}
