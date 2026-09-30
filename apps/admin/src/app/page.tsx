'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';

type Row = Record<string, unknown>;
type Me = { email: string; role: string } | null;

interface Action {
  label: string;
  danger?: boolean;
  /** Returns the request to send; `prompt` asks the operator for a reason first. */
  run: (row: Row, reason?: string) => Promise<unknown>;
  prompt?: string;
}
interface Queue {
  key: string;
  title: string;
  hint: string;
  load: () => Promise<Row[]>;
  columns: { label: string; cell: (r: Row) => React.ReactNode }[];
  actions?: (r: Row) => Action[];
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const short = (v: unknown) => s(v).slice(0, 8);
const post = (path: string, json?: unknown) => api(path, { method: 'POST', json });

const QUEUES: Queue[] = [
  {
    key: 'health',
    title: 'Source health',
    hint: 'Last batch per source. Red = disabled or failing.',
    load: () => api<Row[]>('/admin/health'),
    columns: [
      { label: 'Retailer', cell: (r) => s(r.retailer_slug) },
      { label: 'Method', cell: (r) => s(r.method) },
      {
        label: 'Legal',
        cell: (r) => <span className={`pill ${s(r.legal_status)}`}>{s(r.legal_status)}</span>,
      },
      {
        label: 'Kill switch',
        cell: (r) =>
          r.kill_switch ? <span className="bad">ON: {s(r.kill_switch_reason)}</span> : 'off',
      },
      {
        label: 'Last batch',
        cell: (r) =>
          `${s(r.last_batch_status) || '-'} ${s(r.rows_fetched)} rows, ${s(r.invalid_ratio)} invalid`,
      },
      { label: 'Hours since OK', cell: (r) => s(r.hours_since_ok) },
      { label: 'Held', cell: (r) => s(r.held_pending) },
    ],
  },
  {
    key: 'sources',
    title: 'Sources & kill switch',
    hint: 'Disable immediately on a takedown request. Legal status changes need a second admin (see "Legal changes").',
    load: () => api<Row[]>('/admin/sources'),
    columns: [
      { label: 'Retailer', cell: (r) => s(r.retailer_slug) },
      { label: 'Method', cell: (r) => s(r.method) },
      {
        label: 'Legal',
        cell: (r) => <span className={`pill ${s(r.legal_status)}`}>{s(r.legal_status)}</span>,
      },
      { label: 'Approval', cell: (r) => s(r.approval_ref) },
      { label: 'Killed', cell: (r) => (r.kill_switch ? 'yes' : 'no') },
    ],
    actions: (r) =>
      r.kill_switch
        ? [
            {
              label: 'Release',
              prompt: 'Reason for releasing',
              run: (x, reason) => post(`/admin/sources/${x.id}/kill-switch/release`, { reason }),
            },
          ]
        : [
            {
              label: 'Kill',
              danger: true,
              prompt: 'Reason for disabling (min 5 chars)',
              run: (x, reason) => post(`/admin/sources/${x.id}/kill-switch`, { reason }),
            },
          ],
  },
  {
    key: 'changes',
    title: 'Legal changes (four-eyes)',
    hint: 'A different admin from the requester must approve.',
    load: () => api<Row[]>('/admin/source-changes?status=pending'),
    columns: [
      { label: 'Retailer', cell: (r) => s(r.retailer_slug) },
      { label: 'Requested by', cell: (r) => s(r.requested_by) },
      { label: 'Change', cell: (r) => <code>{JSON.stringify(r.change)}</code> },
      { label: 'Reason', cell: (r) => s(r.reason) },
    ],
    actions: () => [
      { label: 'Approve', run: (x) => post(`/admin/source-changes/${x.id}/approve`) },
      { label: 'Reject', danger: true, run: (x) => post(`/admin/source-changes/${x.id}/reject`) },
    ],
  },
  {
    key: 'held',
    title: 'Held prices',
    hint: 'Prices that moved >50% vs the 30-day median. Nothing is published until approved.',
    load: () => api<Row[]>('/admin/held-prices'),
    columns: [
      { label: 'Retailer', cell: (r) => s(r.retailer_slug) },
      { label: 'Item', cell: (r) => s(r.raw_name) },
      { label: 'New price', cell: (r) => s(r.price_qar) },
      { label: '30d median', cell: (r) => s(r.reference_median) },
      { label: 'Why', cell: (r) => s(r.reason) },
    ],
    actions: () => [
      { label: 'Approve', run: (x) => post(`/admin/held-prices/${x.id}/approve`) },
      { label: 'Reject', danger: true, run: (x) => post(`/admin/held-prices/${x.id}/reject`) },
    ],
  },
  {
    key: 'matches',
    title: 'Match review',
    hint: 'Pick the right canonical product or reject the listing.',
    load: () => api<Row[]>('/admin/matches?limit=100'),
    columns: [
      { label: 'Retailer', cell: (r) => s(r.retailer_slug) },
      { label: 'Listing', cell: (r) => `${s(r.raw_name)} ${s(r.raw_size)}` },
      {
        label: 'Candidates',
        cell: (r) => (
          <ol style={{ margin: 0, paddingInlineStart: '1.2rem' }}>
            {(r.candidates as { product_id: string; name: string; score: number }[]).map((c) => (
              <li key={c.product_id}>
                {c.name} <span className="muted">({Number(c.score).toFixed(2)})</span>{' '}
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void post(`/admin/matches/${r.id}/decide`, { product_id: c.product_id }).then(
                      () => location.reload(),
                    )
                  }
                >
                  match
                </button>
              </li>
            ))}
          </ol>
        ),
      },
    ],
    actions: () => [
      { label: 'Reject', danger: true, run: (x) => post(`/admin/matches/${x.id}/reject`) },
    ],
  },
  {
    key: 'staged',
    title: 'Flyer offers',
    hint: 'Extracted from flyers - verify against the flyer before approving.',
    load: () => api<Row[]>('/admin/staged-offers'),
    columns: [
      { label: 'Retailer', cell: (r) => s(r.retailer_slug) },
      { label: 'Name', cell: (r) => s(r.raw_name) },
      { label: 'Price', cell: (r) => s(r.price_qar) },
      { label: 'Was', cell: (r) => s(r.was_price_qar) },
      { label: 'Valid to', cell: (r) => s(r.valid_to) },
    ],
    actions: () => [
      { label: 'Approve', run: (x) => post(`/admin/staged-offers/${x.id}/approve`) },
      { label: 'Reject', danger: true, run: (x) => post(`/admin/staged-offers/${x.id}/reject`) },
    ],
  },
  {
    key: 'reports',
    title: 'Community price reports',
    hint: 'Pending reports that did not reach consensus. Receipts may contain personal data: view only when needed.',
    load: () => api<Row[]>('/admin/reports'),
    columns: [
      { label: 'Product', cell: (r) => s(r.product_name) },
      { label: 'Retailer', cell: (r) => s(r.retailer_slug) },
      { label: 'Price', cell: (r) => s(r.reported_price_qar) },
      { label: 'Receipt', cell: (r) => (r.has_receipt ? 'yes' : '') },
    ],
    actions: () => [
      { label: 'Accept', run: (x) => post(`/admin/reports/${x.id}/accept`) },
      { label: 'Reject', danger: true, run: (x) => post(`/admin/reports/${x.id}/reject`) },
    ],
  },
  {
    key: 'takedowns',
    title: 'Takedowns & complaints',
    hint: 'Acknowledge within 1 business day; resolve within 2 (policy P6).',
    load: () => api<Row[]>('/admin/takedowns'),
    columns: [
      { label: 'Received', cell: (r) => s(r.received_at).slice(0, 16) },
      { label: 'From', cell: (r) => `${s(r.requester_name)} ${s(r.requester_email)}` },
      { label: 'Summary', cell: (r) => s(r.summary) },
      { label: 'Ack', cell: (r) => (r.acknowledged_at ? 'yes' : 'NO') },
    ],
    actions: () => [
      { label: 'Acknowledge', run: (x) => post(`/admin/takedowns/${x.id}/acknowledge`) },
      {
        label: 'Disable source',
        danger: true,
        prompt: 'Notes',
        run: (x, notes) =>
          post(`/admin/takedowns/${x.id}/resolve`, { action: 'source_disabled', notes }),
      },
      {
        label: 'Reject',
        prompt: 'Notes',
        run: (x, notes) => post(`/admin/takedowns/${x.id}/resolve`, { action: 'rejected', notes }),
      },
    ],
  },
  {
    key: 'claims',
    title: 'Retailer claims',
    hint: 'Verify by calling back a number from the company own website, never the one in the form (docs/runbooks/retailer-onboarding.md). A decision needs a written reason.',
    load: () => api<Row[]>('/admin/claims'),
    columns: [
      { label: 'Received', cell: (r) => s(r.received_at).slice(0, 16) },
      { label: 'Company', cell: (r) => `${s(r.company_name)} ${s(r.website)}` },
      { label: 'Contact', cell: (r) => `${s(r.contact_name)} <${s(r.contact_email)}>` },
      { label: 'Message', cell: (r) => s(r.message) },
      { label: 'Status', cell: (r) => s(r.status) },
    ],
    actions: () => [
      {
        label: 'Verifying',
        prompt: 'Notes',
        run: (x, notes) => post(`/admin/claims/${x.id}/decide`, { decision: 'verifying', notes }),
      },
      {
        label: 'Verified',
        prompt: 'How was this verified?',
        run: (x, notes) => post(`/admin/claims/${x.id}/decide`, { decision: 'verified', notes }),
      },
      {
        label: 'Reject',
        danger: true,
        prompt: 'Reason',
        run: (x, notes) => post(`/admin/claims/${x.id}/decide`, { decision: 'rejected', notes }),
      },
    ],
  },
  {
    key: 'dead',
    title: 'Dead letters',
    hint: 'Rows that failed validation during ingestion (last 50).',
    load: () => api<Row[]>('/admin/dead-letters?limit=50'),
    columns: [
      { label: 'When', cell: (r) => s(r.created_at).slice(0, 16) },
      { label: 'Error', cell: (r) => s(r.error) },
      { label: 'Raw', cell: (r) => <code>{JSON.stringify(r.raw).slice(0, 120)}</code> },
    ],
  },
];

function QueueView({ q }: { q: Queue }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => {
    setRows(null);
    q.load()
      .then(setRows)
      .catch((e: unknown) => setErr(e instanceof ApiError ? e.message : 'failed'));
  }, [q]);
  useEffect(reload, [reload]);

  async function act(row: Row, a: Action) {
    const reason = a.prompt ? window.prompt(a.prompt) : undefined;
    if (a.prompt && !reason) return;
    try {
      await a.run(row, reason ?? undefined);
      setErr('');
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ''}` : 'failed');
    }
  }

  return (
    <section aria-labelledby={`h-${q.key}`}>
      <h2 id={`h-${q.key}`}>{q.title}</h2>
      <p className="muted">{q.hint}</p>
      {err && (
        <p role="alert" className="bad">
          {err}
        </p>
      )}
      {rows === null ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="ok">Nothing to do.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {q.columns.map((c) => (
                  <th key={c.label} scope="col">
                    {c.label}
                  </th>
                ))}
                {q.actions && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={s(r.id) || i}>
                  {q.columns.map((c) => (
                    <td key={c.label}>{c.cell(r)}</td>
                  ))}
                  {q.actions && (
                    <td>
                      <div className="row">
                        {q.actions(r).map((a) => (
                          <button
                            key={a.label}
                            type="button"
                            className={a.danger ? 'danger' : undefined}
                            onClick={() => void act(r, a)}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        {rows ? `${rows.length} rows` : ''} · id prefix shown: {rows?.[0] ? short(rows[0].id) : ''}
      </p>
    </section>
  );
}

export default function AdminHome() {
  const [me, setMe] = useState<Me>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(QUEUES[0]!.key);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<{ user: { email: string; role: string } }>('/me')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null))
      .finally(() => setReady(true));
  }, []);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const r = await api<{ user: { email: string; role: string } }>('/auth/login', {
        method: 'POST',
        json: { email: fd.get('email'), password: fd.get('password') },
      });
      setMe(r.user);
      setErr('');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'failed');
    }
  }

  if (!ready)
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  if (!me || me.role !== 'admin') {
    return (
      <main style={{ maxInlineSize: '24rem' }}>
        <h1>Qarib Admin</h1>
        <p className="muted">Internal tool. Access is logged and audited.</p>
        {me && <p className="bad">Signed in as {me.email}, who is not an admin.</p>}
        <form className="card" onSubmit={login}>
          <p>
            <label htmlFor="e">Email</label>
            <input id="e" name="email" type="email" required autoComplete="username" />
          </p>
          <p>
            <label htmlFor="p">Password</label>
            <input
              id="p"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </p>
          <button type="submit">Sign in</button>
          {err && (
            <p role="alert" className="bad">
              {err}
            </p>
          )}
        </form>
      </main>
    );
  }

  const current = QUEUES.find((q) => q.key === tab)!;
  return (
    <>
      <header>
        <strong>Qarib Admin</strong>
        <nav aria-label="Queues">
          {QUEUES.map((q) => (
            <button
              key={q.key}
              type="button"
              className={q.key === tab ? undefined : 'secondary'}
              aria-current={q.key === tab ? 'page' : undefined}
              onClick={() => setTab(q.key)}
            >
              {q.title}
            </button>
          ))}
        </nav>
        <span className="muted">{me.email}</span>
        <button
          type="button"
          className="secondary"
          onClick={() => void api('/auth/logout', { method: 'POST' }).then(() => setMe(null))}
        >
          Sign out
        </button>
      </header>
      <main>
        <QueueView key={current.key} q={current} />
      </main>
    </>
  );
}
