import { ResetForm } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function Reset({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { dict } = await withLocale(params);
  const { token = '' } = await searchParams;
  return (
    <div style={{ maxInlineSize: '28rem' }}>
      <h1>{dict.account.resetTitle}</h1>
      {token ? (
        <ResetForm token={token} dict={dict} />
      ) : (
        <p className="error">{dict.account.verifyFailed}</p>
      )}
    </div>
  );
}
