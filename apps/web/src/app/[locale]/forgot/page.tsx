import { ForgotForm } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export const metadata = { robots: { index: false } };

export default async function Forgot({ params }: { params: Promise<{ locale: string }> }) {
  const { dict } = await withLocale(params);
  return (
    <div style={{ maxInlineSize: '28rem' }}>
      <h1>{dict.account.forgotTitle}</h1>
      <ForgotForm dict={dict} />
    </div>
  );
}
