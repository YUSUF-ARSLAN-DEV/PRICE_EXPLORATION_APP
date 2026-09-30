/** @type {import('next').NextConfig} */
const prod = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(prod
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

export default {
  poweredByHeader: false,
  // Docker image uses the standalone server (NEXT_STANDALONE=1). Off by default: Windows dev boxes
  // cannot create the symlinks the standalone trace needs.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  transpilePackages: ['@qarib/shared'],
  // Render <title>/<meta description> in <head> for every user agent: by default Next 15 streams metadata
  // into <body> for browsers, which SEO audits (and some crawlers) do not recognise.
  htmlLimitedBots: /.*/,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
