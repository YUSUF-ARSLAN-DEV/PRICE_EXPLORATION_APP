import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyToApi } from './proxy';

const API = 'http://api.internal:4000/v1';
afterEach(() => vi.unstubAllGlobals());

function upstream(init: ResponseInit & { body?: string | null; cookies?: string[] } = {}) {
  const headers = new Headers(init.headers);
  for (const c of init.cookies ?? []) headers.append('set-cookie', c);
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(init.body === undefined ? '{"ok":true}' : init.body, {
      status: init.status ?? 200,
      headers,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('runtime API proxy', () => {
  it('forwards method, path, query string, body and the cookie + CSRF headers to API_URL', async () => {
    const f = upstream({ status: 201 });
    const req = new Request('https://www.example.qa/api/v1/baskets?x=1&y=2', {
      method: 'POST',
      headers: {
        cookie: 'qarib_at=abc',
        'x-qarib-csrf': '1',
        'content-type': 'application/json',
        'idempotency-key': 'k-12345678',
      },
      body: JSON.stringify({ name: 'A' }),
    });
    const res = await proxyToApi(req, ['baskets'], API);
    expect(res.status).toBe(201);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('http://api.internal:4000/v1/baskets?x=1&y=2');
    expect(init.method).toBe('POST');
    const h = init.headers as Headers;
    expect(h.get('cookie')).toBe('qarib_at=abc');
    expect(h.get('x-qarib-csrf')).toBe('1');
    expect(h.get('idempotency-key')).toBe('k-12345678');
    expect(h.get('x-forwarded-host')).toBe('www.example.qa');
    expect(h.get('x-forwarded-proto')).toBe('https');
    expect(h.has('host')).toBe(false); // hop-by-hop / host never forwarded
    expect(init.redirect).toBe('manual');
  });

  it('GET has no body; nested paths are kept and encoded', async () => {
    const f = upstream();
    await proxyToApi(
      new Request('http://x/api/v1/search/autocomplete?q=%D8%AD'),
      ['search', 'autocomplete'],
      API,
    );
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('http://api.internal:4000/v1/search/autocomplete?q=%D8%AD');
    expect(init.body).toBeUndefined();
  });

  it('passes every Set-Cookie header through separately and strips transport headers', async () => {
    upstream({
      cookies: ['qarib_at=1; Path=/; HttpOnly', 'qarib_rt=2; Path=/api/v1/auth; HttpOnly'],
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        'content-encoding': 'gzip',
      },
    });
    const res = await proxyToApi(
      new Request('http://x/api/v1/auth/login', { method: 'POST', body: '{}' }),
      ['auth', 'login'],
      API,
    );
    expect(res.headers.getSetCookie()).toEqual([
      'qarib_at=1; Path=/; HttpOnly',
      'qarib_rt=2; Path=/api/v1/auth; HttpOnly',
    ]);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.has('transfer-encoding')).toBe(false);
    expect(res.headers.has('content-encoding')).toBe(false);
  });

  it('relays 204 without a body and error statuses unchanged', async () => {
    upstream({ status: 204, body: null });
    const no = await proxyToApi(
      new Request('http://x/api/v1/auth/logout', { method: 'POST' }),
      ['auth', 'logout'],
      API,
    );
    expect(no.status).toBe(204);
    expect(await no.text()).toBe('');
    upstream({ status: 422, body: '{"status":422}' });
    const bad = await proxyToApi(
      new Request('http://x/api/v1/auth/login', { method: 'POST', body: '{}' }),
      ['auth', 'login'],
      API,
    );
    expect(bad.status).toBe(422);
  });

  it('answers 502 when the API is down, without leaking the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:4000')),
    );
    const res = await proxyToApi(new Request('http://x/api/v1/health'), ['health'], API);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.5');
  });

  it('refuses path traversal and empty segments (only the API /v1 surface is reachable)', async () => {
    const f = upstream();
    for (const segs of [
      ['..', 'secret'],
      ['a', '..'],
      ['.', 'x'],
      ['a/b'],
      ['a\\b'],
      [''],
      ['search', ''],
    ]) {
      const res = await proxyToApi(new Request('http://x/api/v1/x'), segs, API);
      expect(res.status, JSON.stringify(segs)).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
    await proxyToApi(new Request('http://x/api/v1/x'), ['%2e%2e', 'admin'], API);
    expect(String(f.mock.calls[0]![0])).toContain('%252e%252e'); // encoded once more: stays a literal segment
  });

  it('works when API_URL has no /v1 suffix or a trailing slash', async () => {
    const f = upstream();
    await proxyToApi(new Request('http://x/api/v1/health'), ['health'], 'http://api:4000');
    await proxyToApi(new Request('http://x/api/v1/health'), ['health'], 'http://api:4000/v1/');
    expect(String(f.mock.calls[0]![0])).toBe('http://api:4000/v1/health');
    expect(String(f.mock.calls[1]![0])).toBe('http://api:4000/v1/health');
  });
});
