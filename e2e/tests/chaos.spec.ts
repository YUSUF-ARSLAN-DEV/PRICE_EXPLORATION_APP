import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { STACK_FILE } from './helpers';

// Chaos checks (plan 10.3). They stop real containers of the local stack, so they run serially and
// always restore the stack afterwards. Desktop project only.
test.describe.configure({ mode: 'serial' });
const compose = (...args: string[]) =>
  execFileSync('docker', ['compose', '-f', STACK_FILE, ...args], { encoding: 'utf8' });

async function waitHealthy(request: import('@playwright/test').APIRequestContext) {
  await expect
    .poll(
      async () =>
        (await request.get('/api/v1/health/ready').catch(() => ({ status: () => 0 }))).status(),
      { timeout: 60_000 },
    )
    .toBe(200);
}

test('search keeps working (Postgres fallback) when Meilisearch is down', async ({ request }) => {
  try {
    compose('stop', 'meilisearch');
    const res = await request.get('/api/v1/search?q=milk');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.backend).toBe('postgres');
    expect(body.results.length).toBeGreaterThan(0);
  } finally {
    compose('start', 'meilisearch');
  }
});

test('with the database down: readiness fails, pages show a friendly error (no stack traces), and everything recovers', async ({
  page,
  request,
}) => {
  try {
    compose('stop', 'db');
    await expect
      .poll(async () => (await request.get('/api/v1/health/ready')).status(), { timeout: 30_000 })
      .toBe(503);
    expect((await request.get('/api/v1/health/live')).status()).toBe(200); // liveness must NOT depend on the DB (no restart storms)

    const api = await request.get('/api/v1/search?q=milk');
    expect(api.status()).toBe(503);
    expect(api.headers()['content-type']).toContain('problem+json');
    expect(await api.text()).not.toMatch(/ECONNREFUSED|stack|pg\b|postgres:\/\//i);

    const res = await page.goto('/en/search?q=milk');
    expect(res!.status()).toBeLessThan(600);
    await expect(page.locator('body')).not.toContainText(/ECONNREFUSED|at Object\.|Error: /);
  } finally {
    compose('start', 'db');
  }
  await waitHealthy(request);
  const again = await request.get('/api/v1/search?q=milk');
  expect(again.status()).toBe(200);
});
