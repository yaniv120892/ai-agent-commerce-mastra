import { defineConfig, devices } from '@playwright/test';

// A dedicated port, a throwaway database and a stubbed model: see
// tests/e2e/support/start-e2e-server.mts. `npm run build` must have run first — the
// suite drives the production server, not `next dev`.
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node tests/e2e/support/start-e2e-server.mts',
    url: BASE_URL,
    // Never reused: this server owns the throwaway database. An already-running one on
    // the same port would be a developer's server, pointed at the real database and,
    // worse, a real key.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
