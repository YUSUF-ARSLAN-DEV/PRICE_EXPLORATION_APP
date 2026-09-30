import Link from 'next/link';
import { SearchBox } from '../../components/chrome';
import { serverGet } from '../../lib/api';
import { withLocale } from '../../lib/page';

type Category = {
  id: string;
  parent_id: string | null;
  slug: string;
  name_en: string;
  name_ar: string;
};

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, dict } = await withLocale(params);
  const [popular, cats] = await Promise.all([
    serverGet<{ popular: { query: string }[] }>('/search/popular', 300),
    serverGet<{ categories: Category[] }>('/categories', 300),
  ]);
  const top = (cats?.categories ?? []).filter((c) => c.parent_id === null);
  return (
    <>
      <section className="hero">
        <h1>{dict.home.title}</h1>
        <p className="muted">{dict.home.subtitle}</p>
        <SearchBox locale={locale} dict={dict} />
      </section>

      {popular && popular.popular.length > 0 && (
        <section aria-labelledby="pop">
          <h2 id="pop">{dict.home.popular}</h2>
          <ul className="chips">
            {popular.popular.map((p) => (
              <li key={p.query}>
                <Link className="chip" href={`/${locale}/search?q=${encodeURIComponent(p.query)}`}>
                  {p.query}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {top.length > 0 && (
        <section aria-labelledby="cat">
          <h2 id="cat">{dict.home.categories}</h2>
          <ul className="chips">
            {top.map((c) => (
              <li key={c.id}>
                <Link
                  className="chip"
                  href={`/${locale}/search?q=${encodeURIComponent(locale === 'ar' ? c.name_ar : c.name_en)}`}
                >
                  {locale === 'ar' ? c.name_ar : c.name_en}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="notice" aria-labelledby="how" style={{ marginBlockStart: '2rem' }}>
        <h2 id="how" style={{ marginBlockStart: 0 }}>
          {dict.home.disclaimerTitle}
        </h2>
        <p style={{ marginBlockEnd: 0 }}>{dict.home.disclaimer}</p>
      </section>
    </>
  );
}
