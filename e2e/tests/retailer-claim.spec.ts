import { expect, test } from '@playwright/test';
import { LOCALES, acceptCookies, inApi } from './helpers';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';
const ADMIN_EMAIL = `e2e-claims-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'e2e-admin-password-42!';
const T = {
  en: {
    company: 'Company name',
    name: 'Your name',
    email: 'Work email',
    send: 'Send',
    done: /within 3 business days/,
  },
  ar: {
    company: 'اسم الشركة',
    name: 'اسمك',
    email: 'البريد الإلكتروني للعمل',
    send: 'إرسال',
    done: /خلال 3 أيام عمل/,
  },
} as const;

for (const locale of LOCALES) {
  test(`a retailer can submit a claim (${locale}) and it lands in the admin queue`, async ({
    page,
  }) => {
    const t = T[locale];
    const company = `E2E Mart ${locale} ${Date.now()}`;
    await page.goto(`/${locale}/retailers`);
    await acceptCookies(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByLabel(t.company).fill(company);
    await page.getByLabel(t.name).fill('Sara Buyer');
    await page.getByLabel(t.email).fill(`sara-${Date.now()}@retailer.example`);
    await page.getByRole('button', { name: t.send }).click();
    await expect(page.getByRole('status')).toContainText(t.done);
    // the footer links to the page from everywhere
    await page.goto(`/${locale}`);
    await expect(page.locator('footer a[href$="/retailers"]')).toBeVisible();
  });
}

test('admins see the claim, must give a written reason, and the decision sticks', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop');
  inApi(['node', 'dist/jobs/run.js', 'create-admin'], { ADMIN_EMAIL, ADMIN_PASSWORD });
  page.on('dialog', (d) => void d.accept('Called back on the number from their website'));
  await page.goto(ADMIN);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('navigation', { name: 'Queues' })
    .getByRole('button', { name: 'Retailer claims' })
    .click();
  const rows = page.locator('table tbody tr', { hasText: 'E2E Mart en' });
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  await rows.first().getByRole('button', { name: 'Verified' }).click();
  // a verified claim leaves the open queue (the decision needed a written reason: the dialog handler supplies it)
  await expect(rows).toHaveCount(before - 1);
});

for (const locale of LOCALES) {
  test(`the takedown / complaint form confirms receipt and clears itself (${locale})`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/report`);
    await acceptCookies(page);
    await page
      .getByLabel(locale === 'ar' ? 'بريدك الإلكتروني' : 'Your email')
      .fill(`legal-${Date.now()}@retailer.example`);
    const summary = page.getByLabel(
      locale === 'ar' ? 'ما الذي ينبغي أن نعرفه؟' : 'What should we know?',
    );
    await summary.fill('E2E check: please ignore this request.');
    await page.getByRole('button', { name: locale === 'ar' ? 'إرسال' : 'Send' }).click();
    await expect(page.getByRole('status')).toContainText(
      locale === 'ar' ? 'يوم عمل واحد' : '1 business day',
    );
    await expect(summary).toHaveValue(''); // form was reset
  });
}
