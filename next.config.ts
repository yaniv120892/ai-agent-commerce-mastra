import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @mastra/* hard-depend on execa/ws/croner/posthog-node. Bundling them into the
  // server build makes those deps fail at request time rather than build time.
  serverExternalPackages: ['@mastra/*'],
};

export default nextConfig;
