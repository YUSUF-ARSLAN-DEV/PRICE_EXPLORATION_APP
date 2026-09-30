import type { MetadataRoute } from 'next';
import { indexingEnabled } from '../lib/indexing';

export const dynamic = 'force-dynamic'; // SITE_INDEXING is read per request

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled()) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/en/account',
          '/ar/account',
          '/en/basket',
          '/ar/basket',
          '/en/search',
          '/ar/search',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
