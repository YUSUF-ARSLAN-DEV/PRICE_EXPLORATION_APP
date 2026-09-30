import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchBox } from '../../../components/chrome';
import { t } from '../../../i18n';
import { searchProducts } from '../../../lib/api';
import { formatQar, sizeLabel, unitBaseLabel } from '../../../lib/format';
import { localName, withLocale } from '../../../lib/page';

type SP = Promise<{ q?: string | string[]; sort?: string | string[] }>;
/** Query params can repeat (?q=a&q=b): always take the first value. */
const first = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SP;
}): Promise<Metadata> {
  const { locale, dict } = await withLocale(params);
  const q = first((await searchParams).q);
  return {
    title: q ? t(dict.search.resultsFor, { q }) : dict.home.search,
    robots: { index: false, follow: true },
    alternates: { canonical: `/${locale}/search` },
  };
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: SP;
}) {
  const { locale, dict } = await withLocale(params);
  const sp = await searchParams;
  const q = first(sp.q);
  const sort = first(sp.sort) || 'relevance';
  if (!q.trim()) redirect(`/${locale}`);
  const data = await searchProducts(
    q.trim().slice(0, 100),
    ['relevance', 'price', 'unit_price'].includes(sort) ? sort : 'relevance',
    locale,
  );
  const sorts = [
    ['relevance', dict.search.sortRelevance],
    ['price', dict.search.sortPrice],
    ['unit_price', dict.search.sortUnit],
  ] as const;

  return (
    <>
      <SearchBox locale={locale} dict={dict} initial={q} />
      <h1 style={{ marginBlockStart: '1.25rem' }}>{t(dict.search.resultsFor, { q })}</h1>
      <div className="row" role="group" aria-label={dict.search.sort}>
        <span className="muted">{dict.search.sort}:</span>
        {sorts.map(([key, label]) => (
          <Link
            key={key}
            className="chip"
            aria-current={sort === key ? 'true' : undefined}
            style={sort === key ? { borderColor: 'var(--brand)', fontWeight: 700 } : undefined}
            href={`/${locale}/search?q=${encodeURIComponent(q)}&sort=${key}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div aria-live="polite">
        {!data || data.results.length === 0 ? (
          <p>{dict.search.none}</p>
        ) : (
          <>
            <p className="muted">{t(dict.search.count, { n: data.total })}</p>
            <ul className="grid" style={{ listStyle: 'none', padding: 0 }}>
              {data.results.map((p) => {
                const best = p.offers[0];
                return (
                  <li key={p.id}>
                    <Link className="card product-card" href={`/${locale}/product/${p.id}`}>
                      <strong>{localName(locale, p.name_en, p.name_ar)}</strong>
                      <span className="muted">
                        {[p.brand, sizeLabel(p.size_value, p.size_unit, p.pack_count, locale)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {p.min_price_qar !== null && (
                        <span>
                          <span className="muted">{dict.search.from} </span>
                          <span className="price">{formatQar(p.min_price_qar, locale)}</span>
                        </span>
                      )}
                      {best?.unit_price_qar != null && (
                        <span className="muted">
                          {formatQar(best.unit_price_qar, locale)}{' '}
                          {t(dict.search.unit, {
                            unit: unitBaseLabel(best.unit_price_base, locale),
                          })}
                        </span>
                      )}
                      <span className="muted">
                        {p.offer_count === 1
                          ? dict.search.store1
                          : t(dict.search.stores, { n: p.offer_count })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="hint">{data.disclaimer}</p>
          </>
        )}
      </div>
    </>
  );
}
