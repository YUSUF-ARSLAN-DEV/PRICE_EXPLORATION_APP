import { legal, type PageKey } from '../content/legal';
import type { Dict, Locale } from '../i18n';

export function LegalPage({ page, locale, dict }: { page: PageKey; locale: Locale; dict: Dict }) {
  const body = legal[locale][page];
  const isLegal = page !== 'about';
  return (
    <article style={{ maxInlineSize: '46rem' }}>
      <h1>{body.title}</h1>
      {isLegal && (
        <p className="notice" role="note">
          <strong>{dict.legal.lastUpdated}.</strong> {dict.legal.draftNotice}
        </p>
      )}
      {body.sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p.map((para) => (
            <p key={para}>{para}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
