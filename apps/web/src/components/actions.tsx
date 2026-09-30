'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import type { BasketPlan } from '@qarib/shared';
import { ApiError, clientFetch } from '../lib/api';
import { formatQar } from '../lib/format';
import { t, type Dict, type Locale } from '../i18n';
import { useBasket, useSession } from './providers';

type Status = { kind: 'idle' | 'ok' | 'error'; msg?: string };

function useStatus() {
  const [s, setS] = useState<Status>({ kind: 'idle' });
  return [s, setS] as const;
}
const StatusLine = ({ s }: { s: Status }) =>
  s.kind === 'idle' ? null : (
    <p
      role={s.kind === 'error' ? 'alert' : 'status'}
      className={s.kind === 'error' ? 'error' : 'ok'}
    >
      {s.msg}
    </p>
  );

// ---- product page actions ---------------------------------------------------------------------
export function ProductActions({
  productId,
  productName,
  retailers,
  locale,
  dict,
}: {
  productId: string;
  productName: string;
  retailers: { id: string; name: string }[];
  locale: Locale;
  dict: Dict;
}) {
  const basket = useBasket();
  const { user, ready } = useSession();
  const [alertStatus, setAlertStatus] = useStatus();
  const [reportStatus, setReportStatus] = useStatus();
  const [consent, setConsent] = useState(false);

  async function submitAlert(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const threshold = Number(new FormData(e.currentTarget).get('threshold'));
    try {
      if (consent)
        await clientFetch('/me/consents', {
          method: 'PATCH',
          json: { consents: [{ purpose: 'alerts_email', granted: true }] },
        });
      await clientFetch('/alerts', {
        method: 'POST',
        json: { product_id: productId, threshold_qar: threshold },
      });
      setAlertStatus({ kind: 'ok', msg: dict.product.alertSet });
    } catch (err) {
      const needsConsent = err instanceof ApiError && err.code === 'consent_required';
      setAlertStatus({
        kind: 'error',
        msg: needsConsent ? dict.product.consentAlerts : dict.common.error,
      });
    }
  }

  async function submitReport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await clientFetch('/reports', {
        method: 'POST',
        json: {
          product_id: productId,
          retailer_id: fd.get('retailer'),
          price_qar: Number(fd.get('price')),
        },
      });
      setReportStatus({ kind: 'ok', msg: dict.product.reportThanks });
    } catch {
      setReportStatus({ kind: 'error', msg: dict.common.error });
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => basket.add({ id: productId, name: productName })}
        >
          {basket.has(productId) ? `✓ ${dict.product.inBasket}` : dict.product.addToBasket}
        </button>
        <Link className="btn secondary" href={`/${locale}/basket`}>
          {dict.nav.basket}
        </Link>
      </div>

      <details className="card">
        <summary>{dict.product.setAlert}</summary>
        {ready && !user ? (
          <p>
            <Link href={`/${locale}/login`}>{dict.product.signInNeeded}</Link>
          </p>
        ) : (
          <form method="post" onSubmit={submitAlert} className="stack">
            <div className="field">
              <label htmlFor="threshold">{dict.product.alertHint}</label>
              <input
                id="threshold"
                name="threshold"
                type="number"
                min="0.5"
                step="0.25"
                required
                inputMode="decimal"
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{dict.product.consentAlerts}</span>
            </label>
            <button className="btn" type="submit" disabled={!user}>
              {dict.product.setAlert}
            </button>
            <StatusLine s={alertStatus} />
          </form>
        )}
      </details>

      <details className="card">
        <summary>{dict.product.report}</summary>
        {ready && !user ? (
          <p>
            <Link href={`/${locale}/login`}>{dict.product.signInNeeded}</Link>
          </p>
        ) : (
          <form method="post" onSubmit={submitReport} className="stack">
            <div className="field">
              <label htmlFor="retailer">{dict.product.reportRetailer}</label>
              <select id="retailer" name="retailer" required>
                {retailers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="price">{dict.product.reportPrice}</label>
              <input
                id="price"
                name="price"
                type="number"
                min="0.5"
                step="0.25"
                required
                inputMode="decimal"
              />
            </div>
            <button className="btn" type="submit" disabled={!user}>
              {dict.product.reportSend}
            </button>
            <StatusLine s={reportStatus} />
          </form>
        )}
      </details>
    </div>
  );
}

// ---- basket -------------------------------------------------------------------------------------
export function BasketView({ locale, dict }: { locale: Locale; dict: Dict }) {
  const { lines, setQuantity, remove, clear } = useBasket();
  const { user } = useSession();
  const [plan, setPlan] = useState<BasketPlan | null>(null);
  const [penalty, setPenalty] = useState(0);
  const [saved, setSaved] = useStatus();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lines.length === 0) {
      setPlan(null);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    clientFetch<BasketPlan>('/baskets/optimise', {
      method: 'POST',
      signal: ctl.signal,
      json: {
        items: lines.map((l) => ({ product_id: l.id, quantity: l.quantity })),
        allow_split: true,
        split_penalty_qar: penalty,
      },
    })
      .then(setPlan)
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [lines, penalty]);

  if (lines.length === 0) return <p>{dict.basket.empty}</p>;
  const names = new Map(lines.map((l) => [l.id, l.name]));
  const best = plan?.stores[0];
  const single = plan?.best_single;
  const saving =
    plan?.best_split && single
      ? single.total_qar - plan.best_split.total_qar - plan.best_split.penalty_qar
      : 0;

  return (
    <div className="stack">
      <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
        {lines.map((l) => (
          <li key={l.id} className="card row">
            <Link href={`/${locale}/product/${l.id}`} style={{ flex: 1 }}>
              {l.name}
            </Link>
            <label htmlFor={`q-${l.id}`} className="sr-only">
              {dict.basket.quantity}
            </label>
            <input
              id={`q-${l.id}`}
              type="number"
              min={1}
              max={99}
              value={l.quantity}
              style={{ inlineSize: '5rem' }}
              onChange={(e) => setQuantity(l.id, Number(e.target.value))}
            />
            <button type="button" className="btn secondary" onClick={() => remove(l.id)}>
              {dict.basket.remove}
            </button>
          </li>
        ))}
      </ul>

      <div className="field" style={{ maxInlineSize: '20rem' }}>
        <label htmlFor="pen">{dict.basket.splitPenalty}</label>
        <input
          id="pen"
          type="number"
          min={0}
          max={100}
          step={1}
          value={penalty}
          onChange={(e) => setPenalty(Math.max(0, Number(e.target.value) || 0))}
        />
      </div>

      <h2>{dict.basket.compare}</h2>
      <div aria-live="polite">
        {loading && <p className="muted">{dict.common.loading}</p>}
        {plan && (
          <div className="stack">
            {plan.stores.length > 0 && (
              <table className="prices">
                <thead>
                  <tr>
                    <th scope="col">{dict.product.store}</th>
                    <th scope="col" className="num">
                      {dict.basket.total}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.stores.map((s) => (
                    <tr key={s.retailer_id} className={s === best ? 'best' : undefined}>
                      <th scope="row">
                        {s.retailer_name_en}{' '}
                        {s === best && <span className="badge">{dict.basket.cheapestStore}</span>}
                        {s.items < lines.length - plan.unavailable_product_ids.length && (
                          <div className="muted">
                            {t(dict.basket.missing, {
                              n: lines.length - plan.unavailable_product_ids.length - s.items,
                            })}
                          </div>
                        )}
                      </th>
                      <td className="num price">{formatQar(s.total_qar, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan.best_split && saving > 0 && (
              <div className="card">
                <h3 style={{ marginBlockStart: 0 }}>{dict.basket.split}</h3>
                <p className="ok">{t(dict.basket.splitSaves, { n: saving.toFixed(2) })}</p>
                <ul>
                  {plan.best_split.assignments.map((a) => (
                    <li key={a.product_id}>
                      {names.get(a.product_id) ?? a.product_id} →{' '}
                      {plan.stores.find((s) => s.retailer_id === a.retailer_id)?.retailer_name_en} (
                      {formatQar(a.price_qar * a.quantity, locale)})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.unavailable_product_ids.length > 0 && (
              <p className="notice">
                {t(dict.basket.unavailable, { n: plan.unavailable_product_ids.length })}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="row">
        {user && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await clientFetch('/baskets', {
                  method: 'POST',
                  json: {
                    name: dict.basket.title,
                    items: lines.map((l) => ({ product_id: l.id, quantity: l.quantity })),
                  },
                });
                setSaved({ kind: 'ok', msg: dict.basket.saved });
              } catch {
                setSaved({ kind: 'error', msg: dict.common.error });
              }
            }}
          >
            {dict.basket.save}
          </button>
        )}
        <button type="button" className="btn secondary" onClick={clear}>
          {dict.basket.clear}
        </button>
      </div>
      <StatusLine s={saved} />
    </div>
  );
}

// ---- accounts -------------------------------------------------------------------------------------
function errorMessage(err: unknown, dict: Dict): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return dict.account.badLogin;
    if (err.status === 429) return dict.account.locked;
    if (err.code === 'email_not_verified') return dict.account.notVerified;
    if (err.status === 422) return dict.account.passwordHint;
  }
  return dict.account.genericError;
}

export function LoginForm({ locale, dict }: { locale: Locale; dict: Dict }) {
  const { login } = useSession();
  const [s, setS] = useStatus();
  const [busy, setBusy] = useState(false);
  return (
    <form
      method="post"
      className="stack card"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await login(String(fd.get('email')), String(fd.get('password')));
          window.location.assign(`/${locale}/account`);
        } catch (err) {
          setS({ kind: 'error', msg: errorMessage(err, dict) });
          setBusy(false);
        }
      }}
    >
      <p className="hint">{dict.account.anonymousNote}</p>
      <div className="field">
        <label htmlFor="email">{dict.account.email}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">{dict.account.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <button className="btn" type="submit" disabled={busy}>
        {dict.account.login}
      </button>
      <StatusLine s={s} />
      <p>
        <Link href={`/${locale}/forgot`}>{dict.account.forgot}</Link>
      </p>
      <p>
        {dict.account.noAccount} <Link href={`/${locale}/register`}>{dict.account.register}</Link>
      </p>
    </form>
  );
}

export function RegisterForm({ locale, dict }: { locale: Locale; dict: Dict }) {
  const [s, setS] = useStatus();
  const [busy, setBusy] = useState(false);
  return (
    <form
      method="post"
      className="stack card"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await clientFetch('/auth/register', {
            method: 'POST',
            json: {
              email: fd.get('email'),
              password: fd.get('password'),
              locale,
              acceptTerms: fd.get('terms') === 'on' ? true : false,
            },
          });
          setS({ kind: 'ok', msg: dict.account.registered });
        } catch (err) {
          setS({ kind: 'error', msg: errorMessage(err, dict) });
        }
        setBusy(false);
      }}
    >
      <div className="field">
        <label htmlFor="email">{dict.account.email}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">{dict.account.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          aria-describedby="pw-hint"
        />
        <div id="pw-hint" className="hint">
          {dict.account.passwordHint}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" name="terms" required /> {/* never pre-ticked */}
        <span>{dict.account.terms}</span>
      </label>
      <button className="btn" type="submit" disabled={busy}>
        {dict.account.register}
      </button>
      <StatusLine s={s} />
      <p>
        {dict.account.haveAccount} <Link href={`/${locale}/login`}>{dict.account.login}</Link>
      </p>
    </form>
  );
}

export function ForgotForm({ dict }: { dict: Dict }) {
  const [s, setS] = useStatus();
  return (
    <form
      method="post"
      className="stack card"
      onSubmit={async (e) => {
        e.preventDefault();
        await clientFetch('/auth/forgot-password', {
          method: 'POST',
          json: { email: new FormData(e.currentTarget).get('email') },
        }).catch(() => undefined);
        setS({ kind: 'ok', msg: dict.account.forgotDone });
      }}
    >
      <div className="field">
        <label htmlFor="email">{dict.account.email}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <button className="btn" type="submit">
        {dict.account.forgotSend}
      </button>
      <StatusLine s={s} />
    </form>
  );
}

export function ResetForm({ token, dict }: { token: string; dict: Dict }) {
  const [s, setS] = useStatus();
  return (
    <form
      method="post"
      className="stack card"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await clientFetch('/auth/reset-password', {
            method: 'POST',
            json: { token, password: new FormData(e.currentTarget).get('password') },
          });
          setS({ kind: 'ok', msg: dict.account.resetDone });
        } catch (err) {
          setS({ kind: 'error', msg: errorMessage(err, dict) });
        }
      }}
    >
      <div className="field">
        <label htmlFor="password">{dict.account.password}</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
        <div className="hint">{dict.account.passwordHint}</div>
      </div>
      <button className="btn" type="submit">
        {dict.account.resetTitle}
      </button>
      <StatusLine s={s} />
    </form>
  );
}

/** Runs a one-shot token action (verify email / unsubscribe) on load. */
export function TokenAction({
  token,
  path,
  labels,
}: {
  token: string;
  path: string;
  labels: { working: string; done: string; failed: string };
}) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  useEffect(() => {
    if (!token) {
      setState('failed');
      return;
    }
    clientFetch(path, { method: 'POST', json: { token } })
      .then(() => setState('done'))
      .catch(() => setState('failed'));
  }, [token, path]);
  return (
    <p role="status" className={state === 'failed' ? 'error' : state === 'done' ? 'ok' : 'muted'}>
      {labels[state]}
    </p>
  );
}

// ---- privacy centre ---------------------------------------------------------------------------------
const CONSENT_KEYS = [
  ['history', 'consentHistory'],
  ['alerts_email', 'consentAlerts'],
  ['contribute_receipts', 'consentReceipts'],
  ['analytics', 'consentAnalytics'],
  ['area_sync', 'consentArea'],
] as const;

export function PrivacyCentre({ dict, locale }: { dict: Dict; locale: Locale }) {
  const { user, ready, logout } = useSession();
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<{ id: string; query: string }[]>([]);
  const [s, setS] = useStatus();

  useEffect(() => {
    if (!user) return;
    void clientFetch<{ consents: { purpose: string; granted: boolean }[] }>('/me').then((r) =>
      setGranted(Object.fromEntries(r.consents.map((c) => [c.purpose, c.granted]))),
    );
    void clientFetch<{ id: string; query: string }[]>('/me/history')
      .then(setHistory as never)
      .catch(() => undefined);
  }, [user]);

  if (!ready) return <p>{dict.common.loading}</p>;
  if (!user)
    return (
      <p>
        <Link href={`/${locale}/login`}>{dict.nav.login}</Link>
      </p>
    );

  return (
    <div className="stack">
      <p className="muted">{user.email}</p>
      <section className="card stack" aria-labelledby="c-h">
        <h2 id="c-h" style={{ marginBlockStart: 0 }}>
          {dict.privacy.consents}
        </h2>
        {CONSENT_KEYS.map(([purpose, key]) => (
          <label key={purpose} className="check">
            <input
              type="checkbox"
              checked={granted[purpose] ?? false}
              onChange={async (e) => {
                const value = e.target.checked;
                setGranted((g) => ({ ...g, [purpose]: value }));
                try {
                  await clientFetch('/me/consents', {
                    method: 'PATCH',
                    json: { consents: [{ purpose, granted: value }] },
                  });
                  setS({ kind: 'ok', msg: dict.privacy.saved });
                } catch {
                  setS({ kind: 'error', msg: dict.common.error });
                }
              }}
            />
            <span>{dict.privacy[key]}</span>
          </label>
        ))}
        <StatusLine s={s} />
      </section>

      <section className="card stack" aria-labelledby="e-h">
        <h2 id="e-h" style={{ marginBlockStart: 0 }}>
          {dict.privacy.export}
        </h2>
        <p className="hint">{dict.privacy.exportHint}</p>
        <a className="btn secondary" href="/api/v1/me/export" download="qarib-my-data.json">
          {dict.privacy.export}
        </a>
      </section>

      <section className="card stack" aria-labelledby="h-h">
        <h2 id="h-h" style={{ marginBlockStart: 0 }}>
          {dict.privacy.history}
        </h2>
        {history.length === 0 ? (
          <p className="muted">{dict.privacy.noHistory}</p>
        ) : (
          <ul>
            {history.map((h) => (
              <li key={h.id}>{h.query}</li>
            ))}
          </ul>
        )}
        <button
          className="btn secondary"
          type="button"
          onClick={async () => {
            await clientFetch('/me/history', { method: 'DELETE' }).catch(() => undefined);
            setHistory([]);
          }}
        >
          {dict.privacy.clearHistory}
        </button>
      </section>

      <section className="card stack" aria-labelledby="d-h">
        <h2 id="d-h" style={{ marginBlockStart: 0 }}>
          {dict.privacy.delete}
        </h2>
        <p className="hint">{dict.privacy.deleteHint}</p>
        <form
          method="post"
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await clientFetch('/me', {
                method: 'DELETE',
                json: { password: new FormData(e.currentTarget).get('password') },
              });
              await logout();
              window.location.assign(`/${locale}`);
            } catch {
              setS({ kind: 'error', msg: dict.account.badLogin });
            }
          }}
        >
          <label htmlFor="del-pw">{dict.privacy.confirmPassword}</label>
          <input
            id="del-pw"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          <button className="btn danger" type="submit">
            {dict.privacy.delete}
          </button>
        </form>
      </section>
    </div>
  );
}

// ---- takedown / complaint ---------------------------------------------------------------------------
export function TakedownForm({ dict }: { dict: Dict }) {
  const [s, setS] = useStatus();
  return (
    <form
      method="post"
      className="stack card"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await clientFetch('/takedown', {
            method: 'POST',
            json: {
              requester_name: fd.get('name') || undefined,
              requester_email: fd.get('email'),
              summary: fd.get('summary'),
            },
          });
          setS({ kind: 'ok', msg: dict.report.done });
          e.currentTarget.reset();
        } catch {
          setS({ kind: 'error', msg: dict.common.error });
        }
      }}
    >
      <p>{dict.report.intro}</p>
      <div className="field">
        <label htmlFor="name">{dict.report.name}</label>
        <input id="name" name="name" type="text" maxLength={200} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="email">{dict.report.email}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="summary">{dict.report.summary}</label>
        <textarea id="summary" name="summary" required minLength={5} maxLength={2000} />
      </div>
      <button className="btn" type="submit">
        {dict.report.send}
      </button>
      <StatusLine s={s} />
    </form>
  );
}
