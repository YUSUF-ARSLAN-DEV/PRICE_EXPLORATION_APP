import Link from 'next/link';
import { TokenAction } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function Verify({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale, dict } = await withLocale(params);
  const { token = '' } = await searchParams;
  return (
    <div style={{ maxInlineSize: '28rem' }}>
      <h1>{dict.account.verifying}</h1>
      <TokenAction
        token={token}
        path="/auth/verify-email"
        labels={{
          working: dict.account.verifying,
          done: dict.account.verified,
          failed: dict.account.verifyFailed,
        }}
      />
      <p>
        <Link className="btn" href={`/${locale}/login`}>
          {dict.account.login}
        </Link>
      </p>
    </div>
  );
}
