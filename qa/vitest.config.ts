import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['qa/run-probes.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
