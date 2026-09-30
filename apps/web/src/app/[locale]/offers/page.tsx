import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '../../../i18n';
import { serverGet } from '../../../lib/api';
import { discountPercent, formatDate, formatQar } from '../../../lib/format';
import { localName, withLocale } from '../../../lib/page';

type Row = {
  product_id: string;
  name_en: string;
  name_ar: string | null;
  retailer_name_en: string;
  retailer_name_ar: string | null;
  price_qar: number;
  was_price_qar: number | null;
  promo_ends_at: string | null;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { dict } = await withLocale(params);
  return { title: dict.offers.title };
}

export default async function Offers({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, dict } = await withLocale(params);
  const data = await serverGet<{ offers: Row[] }>('/offers?limit=60', 120);
  return (
    <>
      <h1>{dict.offers.title}</h1>
      {!data || data.offers.length === 0 ? (
        <p>{dict.offers.none}</p>
      ) : (
        <ul className="grid" style={{ listStyle: 'none', padding: 0 }}>
          {data.offers.map((o) => {
            const pct = discountPercent(o.price_qar, o.was_price_qar);
            return (
              <li key={`${o.product_id}-${o.retailer_name_en}`}>
                <Link className="card product-card" href={`/${locale}/product/${o.product_id}`}>
                  <strong>{localName(locale, o.name_en, o.name_ar)}</strong>
                  <span className="muted">
                    {localName(locale, o.retailer_name_en, o.retailer_name_ar)}
                  </span>
                  <span>
                    <span className="price">{formatQar(o.price_qar, locale)}</span>{' '}
                    {o.was_price_qar && (
                      <s className="muted">{formatQar(o.was_price_qar, locale)}</s>
                    )}
                  </span>
                  {pct !== null && <span className="badge">{t(dict.offers.off, { n: pct })}</span>}
                  {o.promo_ends_at && (
                    <span className="muted">
                      {t(dict.offers.until, { date: formatDate(o.promo_ends_at, locale) })}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="hint">{dict.home.disclaimer}</p>
    </>
  );
}
