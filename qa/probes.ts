import probeFile from './probes.json';
import { probeFileSchema, type Probe } from './types';

export const probes: Probe[] = loadProbes();

function loadProbes(): Probe[] {
  const parsed = probeFileSchema.safeParse(probeFile);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`qa/probes.json is invalid (${issues.join('; ')})`);
  }

  const duplicateId = findDuplicateId(parsed.data.probes);
  if (duplicateId !== null) {
    throw new Error(`qa/probes.json has a duplicate probe id (id: ${duplicateId})`);
  }

  return parsed.data.probes;
}

function findDuplicateId(loaded: Probe[]): string | null {
  const seen = new Set<string>();
  for (const probe of loaded) {
    if (seen.has(probe.id)) {
      return probe.id;
    }
    seen.add(probe.id);
  }

  return null;
}
