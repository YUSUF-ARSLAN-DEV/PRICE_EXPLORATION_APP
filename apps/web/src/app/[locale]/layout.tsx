import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Analytics, CookieBanner, Footer, Header, ServiceWorker } from '../../components/chrome';
import { BasketProvider, ConsentProvider, SessionProvider } from '../../components/providers';
import { dirOf, getDict, isLocale, LOCALES } from '../../i18n';
import '../globals.css';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const dict = getDict(locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${dict.brand} - ${dict.tagline}`, template: `%s | ${dict.brand}` },
    description: dict.home.subtitle,
    applicationName: dict.brand,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      title: dict.brand,
      description: dict.home.subtitle,
      locale: locale === 'ar' ? 'ar_QA' : 'en_QA',
      type: 'website',
    },
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#8a1538' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1218' },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDict(locale);
  const nonce = (await headers()).get('x-nonce') ?? undefined; // per-request CSP nonce (middleware)

  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <a className="skip-link" href="#main">
          {dict.skip}
        </a>
        <SessionProvider>
          <BasketProvider>
            <ConsentProvider>
              <Header locale={locale} dict={dict} />
              <main id="main" tabIndex={-1}>
                {children}
              </main>
              <Footer locale={locale} dict={dict} />
              <CookieBanner locale={locale} dict={dict} />
              <Analytics nonce={nonce} />
              <ServiceWorker />
            </ConsentProvider>
          </BasketProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
