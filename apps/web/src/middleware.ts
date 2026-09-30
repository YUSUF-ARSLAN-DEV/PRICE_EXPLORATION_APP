import { NextRequest, NextResponse } from 'next/server';
import { isLocale, negotiateLocale } from './i18n';

/** Content-Security-Policy with a per-request nonce (plan 8.2). */
export function buildCsp(nonce: string, opts: { dev: boolean; analyticsOrigin?: string }): string {
  const connect = ["'self'", ...(opts.analyticsOrigin ? [opts.analyticsOrigin] : [])];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}${opts.dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split('/')[1];

  if (!isLocale(first)) {
    const cookie = req.cookies.get('qarib_locale')?.value;
    const locale = isLocale(cookie) ? cookie : negotiateLocale(req.headers.get('accept-language'));
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url, 307);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const analytics = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== 'production',
    analyticsOrigin: analytics ? new URL(analytics).origin : undefined,
  });
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  res.cookies.set('qarib_locale', first, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return res;
}

export const config = {
  matcher: [
    '/((?!api/|_next/|icons/|favicon|sw\\.js|offline\\.html|\\.well-known|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml).*)',
  ],
};
