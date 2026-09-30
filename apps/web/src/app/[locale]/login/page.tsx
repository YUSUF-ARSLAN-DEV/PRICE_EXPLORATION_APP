import type { Metadata } from 'next';
import { LoginForm } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { dict } = await withLocale(params);
  return { title: dict.account.loginTitle, robots: { index: false } };
}

export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, dict } = await withLocale(params);
  return (
    <div style={{ maxInlineSize: '28rem' }}>
      <h1>{dict.account.loginTitle}</h1>
      <LoginForm locale={locale} dict={dict} />
    </div>
  );
}
