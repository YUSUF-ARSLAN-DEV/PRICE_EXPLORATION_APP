import type { Metadata } from 'next';
import { ClaimForm } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { dict } = await withLocale(params);
  return { title: dict.retailers.title, description: dict.retailers.intro.slice(0, 155) };
}

export default async function Retailers({ params }: { params: Promise<{ locale: string }> }) {
  const { dict } = await withLocale(params);
  return (
    <div style={{ maxInlineSize: '40rem' }}>
      <h1>{dict.retailers.title}</h1>
      <p>{dict.retailers.intro}</p>
      <p>{dict.retailers.how}</p>
      <ClaimForm dict={dict} />
    </div>
  );
}
