import type { Metadata } from 'next';
import { RegisterForm } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { dict } = await withLocale(params);
  return { title: dict.account.registerTitle, robots: { index: false } };
}

export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, dict } = await withLocale(params);
  return (
    <div style={{ maxInlineSize: '28rem' }}>
      <h1>{dict.account.registerTitle}</h1>
      <RegisterForm locale={locale} dict={dict} />
    </div>
  );
}
