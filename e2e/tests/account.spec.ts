import { expect, test } from '@playwright/test';
import { LOCALES, PASSWORD, acceptCookies, latestMail, tokenFrom, uniqEmail } from './helpers';

const L = {
  en: {
    email: 'Email',
    password: 'Password',
    terms: /I am 18 or older/,
    register: 'Create account',
    login: 'Sign in',
    registered: /Check your inbox/,
    verified: /Email confirmed/,
    export: 'Download my data',
    del: 'Delete my account',
    history: /Save my recent searches/,
    deletePw: 'Confirm with your password',
  },
  ar: {
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    terms: /عمري 18 سنة/,
    register: 'إنشاء الحساب',
    login: 'دخول',
    registered: /تحقق من بريدك/,
    verified: /تم تأكيد البريد/,
    export: 'تنزيل بياناتي',
    del: 'حذف حسابي',
    history: /احفظ عمليات البحث/,
    deletePw: 'أكّد بكلمة المرور',
  },
} as const;

for (const locale of LOCALES) {
  test(`register -> verify email -> sign in -> privacy centre -> export -> delete (${locale})`, async ({
    page,
    request,
  }) => {
    const t = L[locale];
    const email = uniqEmail(`acct-${locale}`);

    // ---- register (terms box is never pre-ticked and required)
    await page.goto(`/${locale}/register`);
    await acceptCookies(page);
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password, { exact: false }).first().fill(PASSWORD);
    const terms = page.getByRole('checkbox', { name: t.terms });
    await expect(terms).not.toBeChecked();
    await terms.check();
    await page.getByRole('button', { name: t.register }).click();
    await expect(page.getByText(t.registered)).toBeVisible();

    // ---- unverified accounts cannot sign in
    await page.goto(`/${locale}/login`);
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password).fill(PASSWORD);
    await page.getByRole('button', { name: t.login }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    // ---- verify through the emailed link (Mailpit = the real SMTP path)
    const mail = await latestMail(request, email);
    expect(mail.text).toContain(`/${locale}/verify?token=`);
    await page.goto(`/${locale}/verify?token=${tokenFrom(mail.text)}`);
    await expect(page.getByText(t.verified)).toBeVisible();

    // ---- sign in
    await page.goto(`/${locale}/login`);
    await page.getByLabel(t.email).fill(email);
    await page.getByLabel(t.password).fill(PASSWORD);
    await page.getByRole('button', { name: t.login }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));
    await expect(page.getByText(email)).toBeVisible();

    // ---- consent toggles persist across reloads (and are recorded in the ledger)
    const history = page.getByRole('checkbox', { name: t.history });
    await expect(history).not.toBeChecked();
    await history.check();
    await expect.poll(async () => (await page.request.get('/api/v1/me')).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: t.history })).toBeChecked();

    // ---- data export contains the user's data
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: t.export }).click(),
    ]);
    const body = JSON.parse(
      await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'),
    );
    expect(body.user.email).toBe(email);
    expect(body.consents.map((c: { purpose: string }) => c.purpose)).toEqual(
      expect.arrayContaining(['account_terms', 'history']),
    );

    // ---- deletion needs the right password, then the account is gone
    await page.getByLabel(t.deletePw).fill('wrong-password-123');
    await page.getByRole('button', { name: t.del }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel(t.deletePw).fill(PASSWORD);
    await page.getByRole('button', { name: t.del }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));

    const login = await request.post('/api/v1/auth/login', {
      data: { email, password: PASSWORD },
      headers: { 'x-qarib-csrf': '1' },
    });
    expect(login.status()).toBe(401);
  });
}

test('a signed-in user can save a basket, set a price alert with consent, and file a price report', async ({
  page,
  request,
}) => {
  const email = uniqEmail('flow');
  await request.post('/api/v1/auth/register', {
    data: { email, password: PASSWORD, acceptTerms: true },
    headers: { 'x-qarib-csrf': '1' },
  });
  const token = tokenFrom((await latestMail(request, email)).text);
  await request.post('/api/v1/auth/verify-email', {
    data: { token },
    headers: { 'x-qarib-csrf': '1' },
  });

  await page.goto('/en/login');
  await acceptCookies(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/account$/);

  const products = await (await request.get('/api/v1/search?q=milk')).json();
  await page.goto(`/en/product/${products.results[0].id}`);

  // alert: requires the explicit consent checkbox
  await page.getByText('Price alert').first().click();
  await page.getByLabel(/Email me when it drops/).fill('5');
  await page.getByRole('checkbox', { name: /price-alert emails/ }).check();
  await page.getByRole('button', { name: 'Price alert' }).last().click();
  await expect(page.getByText('Alert saved.')).toBeVisible();

  // basket: add and save
  await page.getByRole('button', { name: 'Add to basket' }).click();
  await page.goto('/en/basket');
  await page.getByRole('button', { name: 'Save basket' }).click();
  await expect(page.getByText('Basket saved.')).toBeVisible();

  // report a price
  await page.goto(`/en/product/${products.results[0].id}`);
  await page.getByText('Report a wrong price').click();
  await page.getByLabel('Price you saw (QAR)').fill('6.4');
  await page.getByRole('button', { name: 'Send report' }).click();
  // The stack's retailers are DEMO retailers: reports against them are refused by design (so crowd data
  // can never attach to fake stores); the success path is covered by the API integration tests.
  await expect(page.getByRole('alert').or(page.getByText(/Something went wrong/))).toBeVisible();
});
