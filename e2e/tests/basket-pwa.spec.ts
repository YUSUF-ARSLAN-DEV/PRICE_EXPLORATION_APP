import { expect, test } from '@playwright/test';
import { LOCALES, acceptCookies } from './helpers';

for (const locale of LOCALES) {
  test(`basket: add items, compare stores, cheapest store is named (${locale})`, async ({
    page,
    request,
  }) => {
    const add = async (q: string) => {
      const res = await (await request.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).json();
      await page.goto(`/${locale}/product/${res.results[0].id}`);
      await acceptCookies(page);
      await page.getByRole('button', { name: /Add to basket|أضف إلى السلة/ }).click();
    };
    await add('milk');
    await add('rice');
    await page.goto(`/${locale}/basket`);
    await expect(page.locator('ul li.card')).toHaveCount(2);
    await expect(page.locator('table.prices tbody tr').first()).toBeVisible();
    await expect(
      page.getByText(locale === 'ar' ? 'أرخص متجر واحد' : 'Cheapest single store'),
    ).toBeVisible();
    // quantity change recalculates
    const before = await page.locator('table.prices .price').first().textContent();
    await page
      .getByLabel(locale === 'ar' ? 'الكمية' : 'Quantity')
      .first()
      .fill('4');
    await expect
      .poll(async () => page.locator('table.prices .price').first().textContent())
      .not.toBe(before);
    // persists across reloads (device storage) and can be cleared
    await page.reload();
    await expect(page.locator('ul li.card')).toHaveCount(2);
    await page
      .getByRole('button', { name: locale === 'ar' ? 'إفراغ السلة' : 'Clear basket' })
      .click();
    await expect(page.locator('ul li.card')).toHaveCount(0);
  });
}

test.describe('PWA', () => {
  test('manifest is valid and installable icons exist', async ({ page, request }) => {
    await page.goto('/en');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await request.get(href!)).json();
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/' });
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  });

  test('service worker installs, never caches API responses, and serves the offline page', async ({
    page,
    context,
  }) => {
    await page.goto('/en');
    await acceptCookies(page);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/$/);
    await page.goto('/en/offers'); // SW now controls the page
    await page.evaluate(() => fetch('/api/v1/search?q=milk').then((r) => r.json()));
    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys())
        for (const req of await (await caches.open(name)).keys())
          out.push(new URL(req.url).pathname);
      return out;
    });
    expect(cached.some((p) => p.startsWith('/api/'))).toBe(false);
    expect(cached.join(' ')).not.toMatch(/product|search|basket|account/);

    await context.setOffline(true);
    await page.goto('/en/offers').catch(() => undefined);
    await expect(page.getByRole('heading', { name: /You are offline/ })).toBeVisible();
    await context.setOffline(false);
  });
});
