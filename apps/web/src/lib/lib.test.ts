import { describe, expect, it } from 'vitest';
import { ar, dirOf, en, flatKeys, getDict, isLocale, negotiateLocale, t } from '../i18n';
import { buildCsp } from '../middleware';
import { chartGeometry } from '../components/price';
import { CONSENT_COOKIE, parseConsent, serializeConsent } from './consent';
import { discountPercent, formatQar, sizeLabel, timeAgo, unitBaseLabel } from './format';

describe('i18n', () => {
  it('Arabic defines exactly the same keys as English (no missing or extra strings)', () => {
    expect(flatKeys(ar).sort()).toEqual(flatKeys(en).sort());
  });

  it('every string is non-empty and placeholders match between languages', () => {
    const flat = (o: object, p = ''): Record<string, string> =>
      Object.fromEntries(
        Object.entries(o).flatMap(([k, v]) =>
          typeof v === 'string' ? [[p + k, v]] : Object.entries(flat(v as object, `${p}${k}.`)),
        ),
      );
    const fe = flat(en);
    const fa = flat(ar);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(fe)) {
      expect(fe[k]!.trim(), k).not.toBe('');
      expect(fa[k]!.trim(), k).not.toBe('');
      expect(ph(fa[k]!), `placeholders of ${k}`).toBe(ph(fe[k]!));
    }
  });

  it('Arabic is right-to-left, English left-to-right, and only en/ar are locales', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
    expect(isLocale('ar') && isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(getDict('ar').brand).not.toBe(getDict('en').brand);
  });

  it('interpolates placeholders and leaves unknown ones visible', () => {
    expect(t('{n} stores', { n: 3 })).toBe('3 stores');
    expect(t('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });

  it('negotiates the locale from Accept-Language (q-values, regions, junk)', () => {
    expect(negotiateLocale('ar-QA,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(negotiateLocale('en-US,en;q=0.9,ar;q=0.8')).toBe('en');
    expect(negotiateLocale('fr-FR,fr;q=0.9,ar;q=0.5')).toBe('ar');
    expect(negotiateLocale('ar;q=0,en;q=0.1')).toBe('en');
    expect(negotiateLocale('fr,de')).toBe('en');
    expect(negotiateLocale('')).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale(';;;q=x,,')).toBe('en');
  });
});

describe('formatting', () => {
  it('prices use Latin digits and two decimals in both languages', () => {
    expect(formatQar(6.5, 'en')).toBe('QAR 6.50');
    expect(formatQar(1234.5, 'en')).toBe('QAR 1,234.50');
    expect(formatQar(6.5, 'ar')).toBe('6.50 ر.ق');
  });

  it('size and unit labels are localised', () => {
    expect(sizeLabel(1, 'l', 1, 'en')).toBe('1 L');
    expect(sizeLabel(500, 'ml', 6, 'en')).toBe('6 × 500 ml');
    expect(sizeLabel(1.5, 'l', 1, 'ar')).toBe('1.5 لتر');
    expect(sizeLabel(null, null, 1, 'en')).toBe('');
    expect(unitBaseLabel('kg', 'ar')).toBe('كجم');
    expect(unitBaseLabel(null, 'en')).toBe('');
  });

  it('computes discounts only for real reductions', () => {
    expect(discountPercent(5, 10)).toBe(50);
    expect(discountPercent(10, 10)).toBeNull();
    expect(discountPercent(10, null)).toBeNull();
    expect(discountPercent(11, 10)).toBeNull();
  });

  it('relative times read naturally', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    expect(timeAgo('2026-10-05T09:00:00Z', 'en', now)).toBe('3 hours ago');
    expect(timeAgo('2026-10-03T12:00:00Z', 'en', now)).toBe('2 days ago');
    expect(timeAgo('2026-10-05T11:59:40Z', 'en', now)).toMatch(/now|minute/);
    expect(timeAgo('2026-10-05T09:00:00Z', 'ar', now)).toMatch(/3/);
  });
});

describe('cookie consent storage', () => {
  it('round-trips and rejects malformed cookies', () => {
    const state = { analytics: true, version: 'v0.1', ts: 1_700_000_000_000 };
    const cookie = serializeConsent(state, true);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/Max-Age=31536000/);
    expect(parseConsent(`a=1; ${cookie.split(';')[0]}; b=2`)).toEqual(state);
    expect(parseConsent('')).toBeNull();
    expect(parseConsent(`${CONSENT_COOKIE}=not-json`)).toBeNull();
    expect(
      parseConsent(`${CONSENT_COOKIE}=${encodeURIComponent('{"analytics":"yes"}')}`),
    ).toBeNull();
    expect(serializeConsent(state, false)).not.toMatch(/Secure/);
  });
});

describe('content security policy', () => {
  it('uses a nonce with strict-dynamic, no unsafe-eval in production, and locks down framing', () => {
    const csp = buildCsp('abc123', { dev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).toContain("connect-src 'self'");
  });

  it('only allows the analytics origin when configured, and unsafe-eval only in dev', () => {
    expect(buildCsp('n', { dev: false, analyticsOrigin: 'https://stats.example.qa' })).toContain(
      "connect-src 'self' https://stats.example.qa",
    );
    expect(buildCsp('n', { dev: true })).toContain("'unsafe-eval'");
  });
});

describe('price chart geometry', () => {
  const pts = [
    { retailer_slug: 'a', day: '2026-09-01', min_price_qar: 10 },
    { retailer_slug: 'a', day: '2026-09-11', min_price_qar: 8 },
    { retailer_slug: 'b', day: '2026-09-06', min_price_qar: 9 },
  ];

  it('scales into the viewport and keeps series separate', () => {
    const g = chartGeometry(pts, 400, 200, 20)!;
    expect(g.lo).toBe(8);
    expect(g.hi).toBe(10);
    expect(g.series.map((s) => s.slug)).toEqual(['a', 'b']);
    const coords = g.series[0]!.points.split(' ').map(
      (p) => p.split(',').map(Number) as [number, number],
    );
    expect(coords[0]![0]).toBeCloseTo(20); // first day at left padding
    expect(coords[1]![0]).toBeCloseTo(380); // last day at right padding
    expect(coords[0]![1]).toBeCloseTo(20); // highest price at top
    expect(coords[1]![1]).toBeCloseTo(180); // lowest at bottom
    for (const s of g.series)
      for (const p of s.points.split(' ')) {
        const [x, y] = p.split(',').map(Number) as [number, number];
        expect(x).toBeGreaterThanOrEqual(20);
        expect(x).toBeLessThanOrEqual(380);
        expect(y).toBeGreaterThanOrEqual(20);
        expect(y).toBeLessThanOrEqual(180);
      }
  });

  it('handles empty, single-point and flat series without NaN', () => {
    expect(chartGeometry([])).toBeNull();
    const one = chartGeometry([{ retailer_slug: 'a', day: '2026-09-01', min_price_qar: 5 }])!;
    expect(one.series[0]!.single).not.toBeNull();
    expect(
      Number.isFinite(one.series[0]!.single!.cx) && Number.isFinite(one.series[0]!.single!.cy),
    ).toBe(true);
    const flat = chartGeometry([
      { retailer_slug: 'a', day: '2026-09-01', min_price_qar: 5 },
      { retailer_slug: 'a', day: '2026-09-02', min_price_qar: 5 },
    ])!;
    expect(flat.series[0]!.points).not.toMatch(/NaN/);
  });
});

describe('indexingEnabled (soft-launch switch)', () => {
  it('is on by default and only SITE_INDEXING=off (any case) turns it off', async () => {
    const { indexingEnabled } = await import('./indexing');
    expect(indexingEnabled({})).toBe(true);
    expect(indexingEnabled({ SITE_INDEXING: 'on' })).toBe(true);
    expect(indexingEnabled({ SITE_INDEXING: 'off' })).toBe(false);
    expect(indexingEnabled({ SITE_INDEXING: 'OFF' })).toBe(false);
    expect(indexingEnabled({ SITE_INDEXING: 'false' })).toBe(true); // only the documented value disables
  });
});
