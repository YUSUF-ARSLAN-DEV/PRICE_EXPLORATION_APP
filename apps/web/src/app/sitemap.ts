import type { MetadataRoute } from 'next';
import { LOCALES } from '../i18n';
import { serverGet } from '../lib/api';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const revalidate = 3600;

const alternates = (path: string) => ({
  languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE}/${l}${path}`])),
});

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await serverGet<{ products: { id: string; updated_at: string }[] }>(
    '/sitemap',
    3600,
  );
  const statics = ['', '/offers', '/about', '/terms', '/privacy', '/cookies', '/report'];
  return [
    ...LOCALES.flatMap((l) =>
      statics.map((s) => ({
        url: `${SITE}/${l}${s}`,
        changeFrequency: 'weekly' as const,
        priority: s === '' ? 1 : 0.4,
        alternates: alternates(s),
      })),
    ),
    ...(data?.products ?? []).flatMap((p) =>
      LOCALES.map((l) => ({
        url: `${SITE}/${l}/product/${p.id}`,
        lastModified: p.updated_at,
        changeFrequency: 'daily' as const,
        priority: 0.8,
        alternates: alternates(`/product/${p.id}`),
      })),
    ),
  ];
}
