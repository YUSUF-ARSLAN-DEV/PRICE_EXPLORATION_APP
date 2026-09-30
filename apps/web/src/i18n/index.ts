import { ar } from './ar';
import { en, type Dict } from './en';

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (v: string | undefined | null): v is Locale => v === 'en' || v === 'ar';
export const dirOf = (l: Locale): 'ltr' | 'rtl' => (l === 'ar' ? 'rtl' : 'ltr');
export const getDict = (l: Locale): Dict => (l === 'ar' ? ar : en);

/** "{n} stores" + {n: 3} => "3 stores". Unknown placeholders are left visible (easier to spot). */
export function t(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Pick a locale from an Accept-Language header (defaults to English; Arabic if preferred). */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const prefs = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = Number(/q=([\d.]+)/.exec(params.join(';'))?.[1] ?? 1);
      return { lang: (tag ?? '').toLowerCase().split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0 };
    })
    .filter((p) => p.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const p of prefs) if (isLocale(p.lang)) return p.lang;
  return DEFAULT_LOCALE;
}

/** Keys of a dictionary as dotted paths - used by the parity test. */
export function flatKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : flatKeys(v as object, `${prefix}${k}.`),
  );
}

export { en, ar };
export type { Dict };
