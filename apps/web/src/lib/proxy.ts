/**
 * Runtime reverse proxy from the web origin to the API (`/api/v1/*` -> `${API_URL}/*`).
 *
 * Why not next.config `rewrites()`: those are frozen into the build, so the same image could not be
 * pointed at different APIs per environment. This reads API_URL on every request.
 * Why a proxy at all: the browser only ever talks to one origin -> no CORS, first-party cookies.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export async function proxyToApi(
  req: Request,
  segments: string[],
  apiUrl = process.env.API_URL ?? 'http://localhost:4000/v1',
): Promise<Response> {
  // Only forward to the API's own versioned surface; refuse anything that could climb out of it.
  if (
    segments.some((s) => s === '..' || s === '.' || s.includes('/') || s.includes('\\') || s === '')
  ) {
    return Response.json({ status: 400, title: 'Bad Request' }, { status: 400 });
  }
  const base = new URL(apiUrl);
  const incoming = new URL(req.url);
  const prefix = base.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  const target = new URL(
    `${prefix}/v1/${segments.map(encodeURIComponent).join('/')}${incoming.search}`,
    base.origin,
  );

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error duplex is required by Node's fetch for streamed request bodies
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return Response.json(
      { status: 502, title: 'Bad Gateway', detail: 'API unreachable' },
      { status: 502 },
    );
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!HOP_BY_HOP.has(k) && k !== 'content-encoding' && k !== 'set-cookie') out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
