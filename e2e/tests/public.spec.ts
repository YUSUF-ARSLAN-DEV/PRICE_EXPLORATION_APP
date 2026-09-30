import { expect, test } from '@playwright/test';
import { LOCALES, T, acceptCookies } from './helpers';

for (const locale of LOCALES) {
  test.describe(`public journey (${locale})`, () => {
    test('home -> search -> product: prices from several stores, cheapest flagged, JSON-LD present', async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await acceptCookies(page);

      const box = page.getByRole('combobox');
      await box.fill(T[locale].milk);
      // autocomplete (keyboard accessible)
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/${locale}/search\\?q=`));

      const card = page.locator('a.product-card').first();
      await expect(card).toBeVisible();
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/product/`));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const rows = page.locator('table.prices tbody tr');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThanOrEqual(2);
      await expect(page.getByText(T[locale].cheapest).first()).toBeVisible();
      await expect(page.locator('time').first()).toBeVisible(); // "last updated" on every price

      const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
      const data = JSON.parse(ld!);
      expect(data['@type']).toBe('Product');
      expect(data.offers.priceCurrency).toBe('QAR');
      expect(data.offers.offerCount).toBeGreaterThanOrEqual(2);
    });

    test('language switch keeps the current page', async ({ page }) => {
      await page.goto(`/${locale}/offers`);
      const other = locale === 'en' ? 'ar' : 'en';
      await page.getByRole('navigation', { name: 'Main' }).locator(`a[hreflang="${other}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/${other}/offers$`));
      await expect(page.locator('html')).toHaveAttribute('dir', other === 'ar' ? 'rtl' : 'ltr');
    });

    test('keyboard: skip link is the first tab stop and moves focus to the content', async ({ page }) => {
      await page.goto(`/${locale}`);
      await page.keyboard.press('Tab');
      const skip = page.locator('a.skip-link');
      await expect(skip).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#main')).toBeFocused();
    });

    test('empty search results and legal pages render a helpful page, not an error', async ({ page }) => {
      await page.goto(`/${locale}/search?q=zzzzzzzznothing`);
      await expect(page.locator('main')).not.toContainText(/Internal Server Error|Application error/i);
      for (const p of ['terms', 'privacy', 'cookies', 'about', 'report']) {
        const res = await page.goto(`/${locale}/${p}`);
        expect(res!.status(), p).toBe(200);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      }
    });
  });
}

test('an unknown product or locale is a 404, never a crash', async ({ page }) => {
  expect((await page.goto('/en/product/00000000-0000-4000-8000-000000000000'))!.status()).toBe(404);
  expect((await page.goto('/en/product/not-a-uuid'))!.status()).toBeLessThan(500);
  await page.goto('/fr/whatever');
  await expect(page).toHaveURL(/\/en\/fr\/whatever|\/en\//); // unknown first segment is redirected into a locale
});

test('first visit negotiates the language from the browser (Arabic)', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ar-QA', extraHTTPHeaderOverrides: { 'accept-language': 'ar-QA,ar;q=0.9' } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/ar$/);
  await ctx.close();
});
