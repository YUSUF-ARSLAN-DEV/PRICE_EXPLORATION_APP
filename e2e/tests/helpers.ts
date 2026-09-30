import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const LOCALES = ['en', 'ar'] as const;
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const STACK_FILE = path.resolve(__dirname, '../../docker-compose.stack.yml');
export const PASSWORD = 'correct-horse-9battery';
export const uniqEmail = (p = 'e2e') => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

/** The newest Mailpit message sent to `to`, polled until it arrives. */
export async function latestMail(request: APIRequestContext, to: string): Promise<{ subject: string; text: string }> {
  let found: { subject: string; text: string } | undefined;
  await expect
    .poll(
      async () => {
        const list = await (await request.get(`${MAILPIT}/api/v1/messages`)).json();
        const msg = (list.messages ?? []).find((m: { To: { Address: string }[] }) => m.To.some((t) => t.Address === to));
        if (!msg) return false;
        const full = await (await request.get(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
        found = { subject: full.Subject, text: full.Text };
        return true;
      },
      { timeout: 15_000, message: `no mail for ${to}` },
    )
    .toBe(true);
  return found!;
}

export const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]{20,})/.exec(text)![1]!;

/** Runs a command in the api container of the local stack (e.g. the create-admin job). */
export function inApi(args: string[], env: Record<string, string> = {}): string {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return execFileSync('docker', ['compose', '-f', STACK_FILE, 'exec', '-T', ...envArgs, 'api', ...args], { encoding: 'utf8' });
}

export async function acceptCookies(page: Page, choice: 'all' | 'necessary' = 'necessary') {
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /Accept all|قبول الكل/ }).or(dialog.getByRole('button', { name: /Only necessary|الضرورية فقط/ })).first().waitFor();
    await dialog.getByRole('button', { name: choice === 'all' ? /Accept all|قبول الكل/ : /Only necessary|الضرورية فقط/ }).click();
  }
}

export const T = {
  en: { milk: 'milk', cheapest: 'Cheapest', basket: 'Basket', login: 'Sign in', search: 'Search' },
  ar: { milk: 'حليب', cheapest: 'الأرخص', basket: 'السلة', login: 'تسجيل الدخول', search: 'بحث' },
} as const;
