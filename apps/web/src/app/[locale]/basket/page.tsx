import type { Metadata } from 'next';
import { BasketView } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { dict } = await withLocale(params);
  return { title: dict.basket.title, robots: { index: false } };
}

export default async function BasketPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, dict } = await withLocale(params);
  return (
    <>
      <h1>{dict.basket.title}</h1>
      <BasketView locale={locale} dict={dict} />
    </>
  );
}
