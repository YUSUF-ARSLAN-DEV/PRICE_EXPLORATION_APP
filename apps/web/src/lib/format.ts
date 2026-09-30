import type { Locale } from '../i18n';

/** Prices are always shown with Latin digits (common in Qatar) and two decimals. */
export function formatQar(n: number, locale: Locale): string {
  const num = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return locale === 'ar' ? `${num} ر.ق` : `QAR ${num}`;
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Qatar',
  }).format(new Date(iso));
}

/** "3 hours ago" / "منذ 3 ساعات" relative to `now`. */
export function timeAgo(iso: string, locale: Locale, now = Date.now()): string {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : 'en', {
    numeric: 'auto',
  });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps)
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  return rtf.format(0, 'minute');
}

export function sizeLabel(
  value: number | null,
  unit: string | null,
  pack: number,
  locale: Locale,
): string {
  if (value === null || unit === null) return '';
  const u: Record<string, [string, string]> = {
    g: ['g', 'غم'],
    kg: ['kg', 'كجم'],
    ml: ['ml', 'مل'],
    l: ['L', 'لتر'],
    pc: ['pcs', 'قطعة'],
  };
  const label = (u[unit] ?? [unit, unit])[locale === 'ar' ? 1 : 0];
  const v = Number(value.toFixed(3)).toString();
  return pack > 1 ? `${pack} × ${v} ${label}` : `${v} ${label}`;
}

export function unitBaseLabel(base: string | null, locale: Locale): string {
  const map: Record<string, [string, string]> = {
    kg: ['kg', 'كجم'],
    l: ['L', 'لتر'],
    pc: ['piece', 'قطعة'],
  };
  return base ? (map[base] ?? [base, base])[locale === 'ar' ? 1 : 0] : '';
}

export function discountPercent(price: number, was: number | null): number | null {
  if (!was || was <= price) return null;
  return Math.round(((was - price) / was) * 100);
}
