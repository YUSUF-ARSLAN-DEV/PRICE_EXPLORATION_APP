import type { Metadata } from 'next';
import { TakedownForm } from '../../../components/actions';
import { withLocale } from '../../../lib/page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { dict } = await withLocale(params);
  return { title: dict.report.title };
}

export default async function Report({ params }: { params: Promise<{ locale: string }> }) {
  const { dict } = await withLocale(params);
  return (
    <div style={{ maxInlineSize: '36rem' }}>
      <h1>{dict.report.title}</h1>
      <TakedownForm dict={dict} />
    </div>
  );
}
