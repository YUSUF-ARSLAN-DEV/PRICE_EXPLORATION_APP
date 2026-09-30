import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a RUNNING stack (plan 10.1):
 *   docker compose -f docker-compose.stack.yml up -d --wait
 *   pnpm --filter @qarib/e2e test
 * Desktop + mobile viewports; every spec exercises English and Arabic.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // the admin kill-switch and chaos specs mutate shared stack state: never run them alongside other specs
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testIgnore: /admin|account|chaos|pwa/ },
  ],
});
