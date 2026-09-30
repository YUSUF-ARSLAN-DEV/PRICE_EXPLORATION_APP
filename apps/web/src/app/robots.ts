import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
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
