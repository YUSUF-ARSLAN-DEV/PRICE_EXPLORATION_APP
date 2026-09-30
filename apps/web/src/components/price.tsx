import type { Offer } from '@qarib/shared';
import type { Dict, Locale } from '../i18n';
import { t } from '../i18n';
import { discountPercent, formatDate, formatQar, timeAgo, unitBaseLabel } from '../lib/format';

/** Table of every store's current price. The cheapest row is highlighted (and labelled in text). */
export function PriceTable({
  offers,
  locale,
  dict,
  now = Date.now(),
}: {
  offers: Offer[];
  locale: Locale;
  dict: Dict;
  now?: number;
}) {
  const best = Math.min(...offers.map((o) => o.price_qar));
  return (
    <div className="table-wrap" role="region" aria-label={dict.product.prices} tabIndex={0}>
      <table className="prices">
        <caption className="sr-only">{dict.product.prices}</caption>
        <thead>
          <tr>
            <th scope="col">{dict.product.store}</th>
            <th scope="col" className="num">
              {dict.product.price}
            </th>
            <th scope="col" className="num">
              {dict.product.unitPrice}
            </th>
            <th scope="col">{dict.product.updated}</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const name =
              locale === 'ar' ? (o.retailer_name_ar ?? o.retailer_name_en) : o.retailer_name_en;
            const pct = discountPercent(o.price_qar, o.was_price_qar);
            return (
              <tr key={o.offer_id} className={o.price_qar === best ? 'best' : undefined}>
                <th scope="row">
                  {name}
                  {o.branch_name && <div className="muted">{o.branch_name}</div>}
                  {o.price_qar === best && <span className="badge">{dict.product.cheapest}</span>}
                </th>
                <td className="num">
                  <span className="price">{formatQar(o.price_qar, locale)}</span>
                  {o.was_price_qar && pct !== null && (
                    <div className="muted">
                      <s>{formatQar(o.was_price_qar, locale)}</s> · {t(dict.offers.off, { n: pct })}
                    </div>
                  )}
                  {!o.in_stock && <div className="error">✕</div>}
                </td>
                <td className="num">
                  {o.unit_price_qar !== null ? (
                    <>
                      {formatQar(o.unit_price_qar, locale)}
                      <div className="muted">
                        {t(dict.search.unit, { unit: unitBaseLabel(o.unit_price_base, locale) })}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <time dateTime={o.observed_at} title={formatDate(o.observed_at, locale)}>
                    {timeAgo(o.observed_at, locale, now)}
                  </time>
                  {o.is_stale && <div className="badge warn">{dict.product.stale}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PALETTE = ['#8a1538', '#0b6b4b', '#1a5fd0', '#b36b00', '#6b2fa0', '#007c91'];

export interface HistoryPoint {
  retailer_slug: string;
  day: string;
  min_price_qar: number;
}

/** Pure geometry so it can be unit-tested: maps history to SVG polyline points per retailer. */
export function chartGeometry(history: HistoryPoint[], w = 640, h = 240, pad = 36) {
  if (history.length === 0) return null;
  const times = history.map((p) => Date.parse(p.day));
  const prices = history.map((p) => p.min_price_qar);
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || 1;
  const x = (ts: number) =>
    pad + (t1 === t0 ? (w - 2 * pad) / 2 : ((ts - t0) / (t1 - t0)) * (w - 2 * pad));
  const y = (p: number) => h - pad - ((p - lo) / span) * (h - 2 * pad);
  const bySlug = new Map<string, HistoryPoint[]>();
  for (const p of history) bySlug.set(p.retailer_slug, [...(bySlug.get(p.retailer_slug) ?? []), p]);
  const series = [...bySlug.entries()].map(([slug, pts], i) => ({
    slug,
    color: PALETTE[i % PALETTE.length]!,
    points: pts
      .map((p) => `${x(Date.parse(p.day)).toFixed(1)},${y(p.min_price_qar).toFixed(1)}`)
      .join(' '),
    single:
      pts.length === 1 ? { cx: x(Date.parse(pts[0]!.day)), cy: y(pts[0]!.min_price_qar) } : null,
  }));
  return { w, h, pad, lo, hi, t0, t1, series };
}

/** Server-rendered SVG line chart with a data-table alternative (no chart library, no JS). */
export function PriceChart({
  history,
  locale,
  dict,
  names,
}: {
  history: HistoryPoint[];
  locale: Locale;
  dict: Dict;
  names: Record<string, string>;
}) {
  const g = chartGeometry(history);
  if (!g) return <p className="muted">{dict.product.noHistory}</p>;
  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="chart"
        viewBox={`0 0 ${g.w} ${g.h}`}
        role="img"
        aria-label={dict.product.history}
        direction="ltr"
      >
        <line
          x1={g.pad}
          y1={g.h - g.pad}
          x2={g.w - g.pad}
          y2={g.h - g.pad}
          stroke="currentColor"
          opacity="0.3"
        />
        <line
          x1={g.pad}
          y1={g.pad}
          x2={g.pad}
          y2={g.h - g.pad}
          stroke="currentColor"
          opacity="0.3"
        />
        <text x={g.pad - 6} y={g.pad + 4} textAnchor="end" fontSize="11" fill="currentColor">
          {g.hi.toFixed(2)}
        </text>
        <text x={g.pad - 6} y={g.h - g.pad} textAnchor="end" fontSize="11" fill="currentColor">
          {g.lo.toFixed(2)}
        </text>
        <text x={g.pad} y={g.h - 10} fontSize="11" fill="currentColor">
          {formatDate(new Date(g.t0).toISOString(), locale)}
        </text>
        <text x={g.w - g.pad} y={g.h - 10} textAnchor="end" fontSize="11" fill="currentColor">
          {formatDate(new Date(g.t1).toISOString(), locale)}
        </text>
        {g.series.map((s) => (
          <g key={s.slug}>
            {s.single ? (
              <circle cx={s.single.cx} cy={s.single.cy} r="4" fill={s.color} />
            ) : (
              <polyline points={s.points} fill="none" stroke={s.color} strokeWidth="2.5" />
            )}
          </g>
        ))}
      </svg>
      <ul className="legend">
        {g.series.map((s) => (
          <li key={s.slug}>
            <span aria-hidden style={{ color: s.color }}>
              ●
            </span>{' '}
            {names[s.slug] ?? s.slug}
          </li>
        ))}
      </ul>
      <details>
        <summary>{dict.product.showData}</summary>
        <table className="prices">
          <tbody>
            {history.map((p) => (
              <tr key={`${p.retailer_slug}-${p.day}`}>
                <th scope="row">{names[p.retailer_slug] ?? p.retailer_slug}</th>
                <td>{p.day}</td>
                <td className="num">{formatQar(p.min_price_qar, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
