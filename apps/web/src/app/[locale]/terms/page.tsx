import type { Metadata } from 'next';
import { LegalPage } from '../../../components/legal-page';
import { legal } from '../../../content/legal';
import { withLocale } from '../../../lib/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await withLocale(params);
  return { title: legal[locale].terms.title };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, dict } = await withLocale(params);
  return <LegalPage page="terms" locale={locale} dict={dict} />;
}
