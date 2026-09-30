import { notFound } from 'next/navigation';
import { getDict, isLocale, type Dict, type Locale } from '../i18n';

/** Resolve the [locale] route param (Next 15: params is a promise) or 404. */
export async function withLocale(
  params: Promise<{ locale: string }>,
): Promise<{ locale: Locale; dict: Dict }> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, dict: getDict(locale) };
}

export const localName = (locale: Locale, en: string, ar: string | null | undefined) =>
  locale === 'ar' && ar ? ar : en;
