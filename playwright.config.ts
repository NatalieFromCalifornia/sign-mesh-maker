import { defineConfig, devices } from '@playwright/test';

/*
 * Browser-level tests, for the failures that only exist in a real browser:
 * canvas sizing under display scaling, WebGL actually drawing, and file
 * upload through to a downloaded STL. Everything expressible as pure logic
 * belongs in the vitest suite instead — it runs in seconds and needs no
 * browser.
 *
 * Requires browsers: `npx playwright install --with-deps chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /*
       * The viewer went blank on every HiDPI display and no test caught it,
       * because the harness happened to run at deviceScaleFactor 1. Scaling is
       * now its own project so it can never silently stop being covered.
       */
      name: 'chromium-hidpi',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 },
    },
  ],

  // Skipped when E2E_BASE_URL points at a deployed environment.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
