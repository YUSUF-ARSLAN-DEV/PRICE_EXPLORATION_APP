import { PrivacyCentre } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export const metadata = { robots: { index: false } };

export default async function Account({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, dict } = await withLocale(params);
  return (
    <div style={{ maxInlineSize: '40rem' }}>
      <h1>{dict.privacy.title}</h1>
      <PrivacyCentre dict={dict} locale={locale} />
    </div>
  );
}
