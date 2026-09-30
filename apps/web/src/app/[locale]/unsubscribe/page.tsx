import { TokenAction } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function Unsubscribe({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { dict } = await withLocale(params);
  const { token = '' } = await searchParams;
  return (
    <div style={{ maxInlineSize: '32rem' }}>
      <h1>{dict.unsubscribe.title}</h1>
      <TokenAction
        token={token}
        path="/alerts/unsubscribe"
        labels={{
          working: dict.unsubscribe.working,
          done: dict.unsubscribe.done,
          failed: dict.unsubscribe.failed,
        }}
      />
    </div>
  );
}
