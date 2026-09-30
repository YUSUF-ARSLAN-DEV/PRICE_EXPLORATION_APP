import { expect, test } from '@playwright/test';
import { LOCALES } from './helpers';

for (const locale of LOCALES) {
  test.describe(`cookie consent (${locale})`, () => {
    test('nothing optional loads before consent; choice persists and can be reopened', async ({ page, context }) => {
      const scripts: string[] = [];
      page.on('request', (r) => {
        if (r.resourceType() === 'script' && !r.url().startsWith(new URL(page.url() || 'http://localhost:3000').origin)) scripts.push(r.url());
      });
      await page.goto(`/${locale}`);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('analytics-toggle')).not.toBeChecked();
      expect((await context.cookies()).map((c) => c.name)).not.toContain('qarib_consent');

      await dialog.getByRole('button', { name: locale === 'ar' ? 'الضرورية فقط' : 'Only necessary' }).click();
      await expect(dialog).toBeHidden();
      const consent = (await context.cookies()).find((c) => c.name === 'qarib_consent');
      expect(consent).toBeTruthy();
      expect(JSON.parse(decodeURIComponent(consent!.value))).toMatchObject({ analytics: false, version: 'v0.1' });

      await page.reload();
      await expect(page.getByRole('dialog')).toBeHidden();
      expect(scripts, 'no third-party scripts, ever').toEqual([]);
      await expect(page.locator('script[src*="analytics"], script[src*="plausible"], script[src*="umami"]')).toHaveCount(0);

      await page.getByRole('button', { name: locale === 'ar' ? 'إعدادات ملفات تعريف الارتباط' : 'Cookie settings' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  });
}

test.describe('security behaviour in a real browser', () => {
  test('session cookies are HttpOnly and invisible to JavaScript; no CSP violations on core pages', async ({ page, context, request }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
    });
    page.on('pageerror', (e) => violations.push(String(e)));
    for (const url of ['/en', '/ar', '/en/offers', '/en/login', '/en/basket']) {
      await page.goto(url);
      await expect(page.locator('main')).toBeVisible();
    }
    const res = await (await request.get('/api/v1/search?q=milk')).json();
    await page.goto(`/en/product/${res.results[0].id}`);
    await expect(page.locator('table.prices').first()).toBeVisible();
    expect(violations).toEqual([]);

    // sign in through the API and inspect the cookies the browser received
    const email = `sec-${Date.now()}@example.com`;
    const reg = await context.request.post('/api/v1/auth/register', { data: { email, password: 'correct-horse-9battery', acceptTerms: true }, headers: { 'x-qarib-csrf': '1' } });
    expect(reg.status()).toBe(202);
    const cookies = await context.cookies();
    for (const c of cookies.filter((c) => c.name.startsWith('qarib_') && c.name !== 'qarib_consent' && c.name !== 'qarib_locale')) {
      expect(c.httpOnly, c.name).toBe(true);
      expect(c.sameSite, c.name).toBe('Lax');
    }
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/qarib_(at|rt)/);
  });

  test('reflected script injection in the search box is rendered as text and never executes', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', async (d) => {
      dialogs++;
      await d.dismiss();
    });
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    await page.goto(`/en/search?q=${encodeURIComponent(payload)}`);
    await expect(page.locator('h1')).toContainText('<img src=x');
    await page.waitForTimeout(500);
    expect(dialogs).toBe(0);
    expect(await page.locator('main img[src="x"]').count()).toBe(0);
  });

  test('the admin console and the API docs are not exposed on the public origin', async ({ request }) => {
    expect((await request.get('/api/v1/admin/sources')).status()).toBe(401);
    expect((await request.get('/api/v1/admin/health')).status()).toBe(401);
    const res = await request.get('/api/v1/me');
    expect(res.status()).toBe(401);
    expect(res.headers()['content-type']).toContain('problem+json');
    // path traversal through the runtime proxy is refused
    const trav = await request.get('/api/v1/..%2F..%2Fetc%2Fpasswd');
    expect([400, 404]).toContain(trav.status());
  });

  test('state-changing API calls with cookies but without the CSRF header are refused', async ({ context }) => {
    const email = `csrf-${Date.now()}@example.com`;
    await context.request.post('/api/v1/auth/register', { data: { email, password: 'correct-horse-9battery', acceptTerms: true }, headers: { 'x-qarib-csrf': '1' } });
    await context.addCookies([{ name: 'qarib_at', value: 'x', url: 'http://localhost:3000' }]);
    const res = await context.request.patch('/api/v1/me', { data: { locale: 'ar' } });
    expect(res.status()).toBe(403);
  });
});
