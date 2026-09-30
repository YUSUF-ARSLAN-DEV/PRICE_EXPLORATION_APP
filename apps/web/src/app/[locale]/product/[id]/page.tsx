import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductActions } from '../../../../components/actions';
import { PriceChart, PriceTable } from '../../../../components/price';
import { getProduct } from '../../../../lib/api';
import { formatQar, sizeLabel } from '../../../../lib/format';
import { localName, withLocale } from '../../../../lib/page';
import { LOCALES } from '../../../../i18n';

type P = Promise<{ locale: string; id: string }>;
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { locale, id } = await params;
  const { locale: l, dict } = await withLocale(Promise.resolve({ locale }));
  const data = await getProduct(id);
  if (!data) return { title: dict.product.notFound, robots: { index: false } };
  const p = data.product;
  const name = localName(l, p.name_en, p.name_ar);
  const description = `${name}${p.min_price_qar !== null ? ` - ${formatQar(p.min_price_qar, l)} - ` : ' - '}${dict.home.subtitle}`;
  return {
    title: name,
    description,
    alternates: {
      canonical: `/${l}/product/${id}`,
      languages: Object.fromEntries(LOCALES.map((x) => [x, `/${x}/product/${id}`])),
    },
    openGraph: { title: name, description, type: 'website' },
  };
}

export default async function ProductPage({ params }: { params: P }) {
  const { id } = await params;
  const { locale, dict } = await withLocale(params);
  const data = await getProduct(id);
  if (!data) notFound();
  const { product: p, history } = data;
  const name = localName(locale, p.name_en, p.name_ar);
  const size = sizeLabel(p.size_value, p.size_unit, p.pack_count, locale);
  const retailers = [
    ...new Map(
      p.offers.map((o) => [
        o.retailer_id,
        localName(locale, o.retailer_name_en, o.retailer_name_ar),
      ]),
    ).entries(),
  ].map(([rid, n]) => ({ id: rid, name: n }));
  const names = Object.fromEntries(
    p.offers.map((o) => [
      o.retailer_slug,
      localName(locale, o.retailer_name_en, o.retailer_name_ar),
    ]),
  );

  // schema.org Product + AggregateOffer (plan 7.3)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name_en,
    ...(p.name_ar ? { alternateName: p.name_ar } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    url: `${SITE}/${locale}/product/${id}`,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'QAR',
      lowPrice: p.min_price_qar,
      highPrice: p.max_price_qar,
      offerCount: p.offer_count,
      offers: p.offers.map((o) => ({
        '@type': 'Offer',
        price: o.price_qar,
        priceCurrency: 'QAR',
        availability: o.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        priceValidUntil: undefined,
        seller: { '@type': 'Organization', name: o.retailer_name_en },
      })),
    },
  };

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <p>
        <Link href={`/${locale}`}>← {dict.nav.home}</Link>
      </p>
      <h1>{name}</h1>
      <p className="muted">{[p.brand, size].filter(Boolean).join(' · ')}</p>

      <h2>{dict.product.prices}</h2>
      <PriceTable offers={p.offers} locale={locale} dict={dict} />
      <p className="hint">{data.disclaimer}</p>

      <div className="grid" style={{ marginBlockStart: '1.5rem' }}>
        <section aria-labelledby="hist">
          <h2 id="hist" style={{ marginBlockStart: 0 }}>
            {dict.product.history}
          </h2>
          <PriceChart history={history} locale={locale} dict={dict} names={names} />
        </section>
        <section aria-label={dict.product.addToBasket}>
          <ProductActions
            productId={p.id}
            productName={name}
            retailers={retailers}
            locale={locale}
            dict={dict}
          />
        </section>
      </div>
    </article>
  );
}
