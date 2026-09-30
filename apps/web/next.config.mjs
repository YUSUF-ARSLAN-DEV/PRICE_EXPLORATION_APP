/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? 'http://localhost:4000/v1';
const API_ORIGIN = new URL(API_URL).origin;
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
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Browsers talk to the API through this same-origin proxy: no CORS, cookies stay first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/v1/:path*` }];
  },
};
