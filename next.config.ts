import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @mastra/* hard-depend on execa/ws/croner/posthog-node. Bundling them into the
  // server build makes those deps fail at request time rather than build time.
  serverExternalPackages: ['@mastra/*'],

  // Without this Next walks up to an unrelated lockfile in the home directory and
  // traces the wrong root.
  outputFileTracingRoot: path.join(import.meta.dirname, '.'),
};

export default nextConfig;
