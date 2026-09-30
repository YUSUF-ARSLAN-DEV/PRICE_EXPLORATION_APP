'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { clientFetch } from '../lib/api';
import type { Dict, Locale } from '../i18n';
import { useBasket, useConsent, useSession } from './providers';

export function Header({ locale, dict }: { locale: Locale; dict: Dict }) {
  const pathname = usePathname() ?? `/${locale}`;
  const { user, ready, logout } = useSession();
  const { count } = useBasket();
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const switchHref = pathname.replace(/^\/(en|ar)(?=\/|$)/, `/${other}`);
  const item = (href: string, label: string, exact = false) => {
    const full = `/${locale}${href}`;
    const current = exact
      ? pathname === full
      : pathname === full || pathname.startsWith(`${full}/`);
    return (
      <Link href={full} aria-current={current ? 'page' : undefined}>
        {label}
      </Link>
    );
  };
  return (
    <header className="site-header">
      <div className="bar">
        <Link href={`/${locale}`} className="brand" aria-label={`${dict.brand} - ${dict.nav.home}`}>
          {dict.brand}
        </Link>
        <nav className="site-nav" aria-label="Main">
          {item('', dict.nav.home, true)}
          {item('/offers', dict.nav.offers)}
          <Link
            href={`/${locale}/basket`}
            aria-current={pathname === `/${locale}/basket` ? 'page' : undefined}
          >
            {dict.nav.basket}
            {/* always rendered (hidden while empty) so the header never changes size after hydration */}
            <span
              className="badge"
              aria-hidden={count === 0}
              aria-label={count > 0 ? `${count}` : undefined}
              style={{ marginInlineStart: 6, visibility: count > 0 ? 'visible' : 'hidden' }}
            >
              {count > 0 ? count : 0}
            </span>
          </Link>
          {ready && user ? (
            <>
              {item('/account', dict.nav.account)}
              <button type="button" className="link-button" onClick={() => void logout()}>
                {dict.nav.logout}
              </button>
            </>
          ) : ready ? (
            item('/login', dict.nav.login)
          ) : (
            // reserve the space while the session is being checked (prevents layout shift)
            <span aria-hidden="true" style={{ visibility: 'hidden' }}>
              {dict.nav.login}
            </span>
          )}
          <Link href={switchHref} lang={other} hrefLang={other} aria-label={dict.nav.languageLabel}>
            {dict.nav.language}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer({ locale, dict }: { locale: Locale; dict: Dict }) {
  const { openSettings } = useConsent();
  return (
    <footer className="site-footer">
      <div className="inner">
        <p>{dict.footer.operator}</p>
        <nav aria-label="Legal">
          <Link href={`/${locale}/terms`}>{dict.footer.terms}</Link>
          <Link href={`/${locale}/privacy`}>{dict.footer.privacy}</Link>
          <Link href={`/${locale}/cookies`}>{dict.footer.cookies}</Link>
          <Link href={`/${locale}/about`}>{dict.footer.about}</Link>
          <Link href={`/${locale}/report`}>{dict.footer.report}</Link>
          <button type="button" className="link-button" onClick={openSettings}>
            {dict.cookies.settings}
          </button>
        </nav>
        <p>{dict.footer.draft}</p>
      </div>
    </footer>
  );
}

export function CookieBanner({ locale, dict }: { locale: Locale; dict: Dict }) {
  const { state, settingsOpen, set, closeSettings } = useConsent();
  const analyticsRef = useRef<HTMLInputElement>(null);
  const visible = state === null || settingsOpen;
  useEffect(() => {
    if (analyticsRef.current) analyticsRef.current.checked = state?.analytics ?? false; // never pre-ticked
  }, [state, settingsOpen]);
  if (!visible) return null;
  return (
    <div className="cookie-banner" role="dialog" aria-modal="false" aria-labelledby="cookie-title">
      <h2 id="cookie-title" style={{ marginBlockStart: 0 }}>
        {dict.cookies.title}
      </h2>
      <p>{dict.cookies.text}</p>
      <div className="stack">
        <label className="check">
          <input type="checkbox" checked disabled readOnly /> <span>{dict.cookies.necessary}</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            ref={analyticsRef}
            defaultChecked={false}
            data-testid="analytics-toggle"
          />
          <span>{dict.cookies.analytics}</span>
        </label>
        <div className="row">
          <button type="button" className="btn" onClick={() => set(true)}>
            {dict.cookies.acceptAll}
          </button>
          <button type="button" className="btn secondary" onClick={() => set(false)}>
            {dict.cookies.rejectAll}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => set(analyticsRef.current?.checked ?? false)}
          >
            {dict.cookies.save}
          </button>
          {state && (
            <button type="button" className="link-button" onClick={closeSettings}>
              {dict.common.close}
            </button>
          )}
        </div>
        <Link href={`/${locale}/cookies`}>{dict.cookies.more}</Link>
      </div>
    </div>
  );
}

/** Loads the (self-hosted) analytics script ONLY after the visitor opted in (plan 7.6/7.7). */
export function Analytics({ nonce }: { nonce?: string }) {
  const { state } = useConsent();
  const src = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
  if (!state?.analytics || !src) return null;
  return (
    <Script
      src={src}
      strategy="afterInteractive"
      nonce={nonce}
      data-domain={process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN}
    />
  );
}

/** Registers the service worker (installable PWA, offline shell). */
export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}

export function SearchBox({
  locale,
  dict,
  initial = '',
}: {
  locale: Locale;
  dict: Dict;
  initial?: string;
}) {
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<{ text: string; kind: string; product_id?: string }[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      try {
        const res = await clientFetch<{
          suggestions: { text: string; kind: string; product_id?: string }[];
        }>(`/search/autocomplete?q=${encodeURIComponent(q.trim())}`, {
          signal: abort.current.signal,
        });
        setItems(res.suggestions);
        setOpen(true);
      } catch {
        /* aborted or API down: no suggestions */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [q, setItems, setOpen]);

  const go = (text: string) => {
    window.location.assign(`/${locale}/search?q=${encodeURIComponent(text)}`);
  };
  return (
    <form
      className="search-form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) go(q.trim());
      }}
    >
      <div className="box">
        <label htmlFor="q" className="sr-only">
          {dict.home.search}
        </label>
        <input
          id="q"
          type="search"
          name="q"
          value={q}
          placeholder={dict.home.placeholder}
          autoComplete="off"
          maxLength={100}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls="suggest-list"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `sg-${active}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === 'Enter' && active >= 0 && items[active]) {
              e.preventDefault();
              go(items[active]!.text);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        {open && items.length > 0 && (
          <ul
            className="suggestions"
            id="suggest-list"
            role="listbox"
            aria-label={dict.search.suggestions}
          >
            {items.map((s, i) => (
              <li
                key={`${s.kind}-${s.text}`}
                id={`sg-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={() => go(s.text)}
              >
                {s.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="btn" type="submit">
        {dict.home.search}
      </button>
    </form>
  );
}
