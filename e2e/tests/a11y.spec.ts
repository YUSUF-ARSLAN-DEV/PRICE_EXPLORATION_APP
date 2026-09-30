import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LOCALES, acceptCookies } from './helpers';

/** WCAG 2.2 AA automated checks (plan 7.4). Automated tools catch ~1/3 of issues: manual review still required. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = ['critical', 'serious'];

let cachedId: string | undefined; // one search per worker: the API rate limiter is (rightly) active in the stack
async function productUrl(request: import('@playwright/test').APIRequestContext, locale: string) {
  if (!cachedId) {
    const res = await (await request.get('/api/v1/search?q=milk')).json();
    cachedId = res.results[0].id as string;
  }
  return `/${locale}/product/${cachedId}`;
}

for (const locale of LOCALES) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`no serious accessibility violations (${locale}, ${scheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const pages = [
        `/${locale}`,
        `/${locale}/search?q=milk`,
        await productUrl(request, locale),
        `/${locale}/offers`,
        `/${locale}/login`,
        `/${locale}/register`,
        `/${locale}/terms`,
        `/${locale}/report`,
      ];
      for (const url of pages) {
        await page.goto(url);
        await expect(page.locator('main')).toBeVisible();
        await acceptCookies(page);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const bad = results.violations.filter((v) => BLOCKING.includes(v.impact ?? ''));
        expect(
          bad.map((v) => `${url}: ${v.id} (${v.impact}) - ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`),
          'axe violations',
        ).toEqual([]);
      }
    });
  }

  test(`cookie banner and basket view are accessible (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    let r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.filter((v) => BLOCKING.includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);
    await acceptCookies(page);
    await page.goto(`/${locale}/basket`);
    r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.filter((v) => BLOCKING.includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);
  });
}

test('all interactive controls are reachable and usable at 320 px width without horizontal scroll', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const url of ['/en', '/ar', '/en/offers', await productUrl(request, 'en'), await productUrl(request, 'ar')]) {
    await page.goto(url);
    await acceptCookies(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${url} overflows horizontally`).toBeLessThanOrEqual(1);
  }
});
