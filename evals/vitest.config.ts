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
    include: ['evals/eval-*.ts'],
    // The online suite issues real model calls in sequence against a shared spend
    // budget; parallel files would race the accumulator and blow past the cap.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
