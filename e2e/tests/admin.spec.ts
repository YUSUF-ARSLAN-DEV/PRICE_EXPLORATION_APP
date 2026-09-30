import { expect, test } from '@playwright/test';
import { inApi } from './helpers';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';
const EMAIL = `e2e-admin-${Date.now()}@example.com`;
const PASSWORD = 'e2e-admin-password-42!';

test.beforeAll(() => {
  inApi(['node', 'dist/jobs/run.js', 'create-admin'], { ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: PASSWORD });
});

test('admin console: sign in, see source health, kill a source (public prices vanish), release it (they return)', async ({ page, request }) => {
  page.on('dialog', (d) => void d.accept('E2E takedown drill - please ignore'));
  const count = async () => ((await (await request.get('/api/v1/search?q=milk')).json()).results as unknown[]).length;
  const before = await count();
  expect(before).toBeGreaterThan(0);

  await page.goto(ADMIN);
  await expect(page.getByRole('heading', { name: 'Qarib Admin' })).toBeVisible();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Source health' })).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Queues' }).getByRole('button', { name: 'Sources & kill switch' }).click();
  const demoRows = page.locator('table tbody tr', { hasText: 'demo-mart' });
  await demoRows.getByRole('button', { name: 'Kill' }).first().click();
  await expect(demoRows.getByRole('button', { name: 'Release' })).toBeVisible();
  await expect.poll(count).toBeLessThan(before + 1);
  const afterKill = await (await request.get('/api/v1/search?q=milk')).json();
  const stores = afterKill.results.flatMap((p: { offers: { retailer_slug: string }[] }) => p.offers.map((o) => o.retailer_slug));
  expect(stores).not.toContain('demo-mart');

  await demoRows.getByRole('button', { name: 'Release' }).first().click();
  await expect(demoRows.getByRole('button', { name: 'Kill' }).first()).toBeVisible();
  const restored = await (await request.get('/api/v1/search?q=milk')).json();
  expect(restored.results.flatMap((p: { offers: { retailer_slug: string }[] }) => p.offers.map((o) => o.retailer_slug))).toContain('demo-mart');
});

test('a normal user is refused by the admin console', async ({ page, request }) => {
  const email = `e2e-user-${Date.now()}@example.com`;
  await request.post('/api/v1/auth/register', { data: { email, password: 'correct-horse-9battery', acceptTerms: true }, headers: { 'x-qarib-csrf': '1' } });
  await page.goto(ADMIN);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-9battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible(); // unverified => refused; admin UI never shows queues
  await expect(page.getByRole('heading', { name: 'Source health' })).toHaveCount(0);
});
