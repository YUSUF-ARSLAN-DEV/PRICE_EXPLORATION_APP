// Smoke test for a running stack (docker-compose.stack.yml locally, or a deployed environment).
//   node scripts/smoke-stack.mjs [webBase] [adminBase]
// Exit code 1 on the first failed check. Used by CI after the image build and by deploy
// pipelines after each rollout (plan 9.9 "smoke tests").
const web = process.argv[2] ?? 'http://localhost:3000';
const admin = process.argv[3] ?? 'http://localhost:3001';
// Local/CI stacks are seeded with demo data; real environments are not (set SMOKE_EXPECT_DATA=1 to require it).
const expectData = process.env.SMOKE_EXPECT_DATA === '1';

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}: ${err.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const get = (url, init) => fetch(url, { redirect: 'manual', ...init });

await check('web: / redirects to a locale', async () => {
  const r = await get(`${web}/`);
  assert(
    r.status === 307 && /\/(en|ar)$/.test(r.headers.get('location') ?? ''),
    `status ${r.status} -> ${r.headers.get('location')}`,
  );
});
await check('web: Arabic negotiated from Accept-Language', async () => {
  const r = await get(`${web}/`, { headers: { 'accept-language': 'ar-QA,ar;q=0.9' } });
  assert(r.headers.get('location')?.endsWith('/ar'), r.headers.get('location'));
});
await check('web: /ar is RTL, /en is LTR, both send a nonce CSP and security headers', async () => {
  for (const [loc, dir] of [
    ['ar', 'rtl'],
    ['en', 'ltr'],
  ]) {
    const r = await get(`${web}/${loc}`);
    const html = await r.text();
    assert(r.status === 200, `${loc} status ${r.status}`);
    assert(html.includes(`<html lang="${loc}" dir="${dir}"`), `${loc} html attrs`);
    const csp = r.headers.get('content-security-policy') ?? '';
    assert(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp), `csp: ${csp}`);
    assert(csp.includes("frame-ancestors 'none'"), 'frame-ancestors');
    assert(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
    assert(r.headers.get('x-frame-options') === 'DENY', 'xfo');
    assert(!r.headers.get('x-powered-by'), 'x-powered-by leaked');
  }
});
await check('api (via web proxy): health', async () => {
  const r = await fetch(`${web}/api/v1/health`);
  const body = await r.json();
  assert(r.status === 200 && body.status === 'ok', JSON.stringify(body));
});
let productId;
await check(
  'search answers with the documented shape' +
    (expectData ? ' and finds demo milk from 2 stores' : ''),
  async () => {
    const r = await fetch(`${web}/api/v1/search?q=milk`);
    const body = await r.json();
    assert(r.status === 200 && Array.isArray(body.results), 'bad response');
    assert(body.disclaimer, 'disclaimer missing');
    if (expectData) {
      assert(body.results.length >= 1, 'no results');
      assert(
        body.results.some((p) => p.offer_count >= 2),
        'no product with 2 offers',
      );
      productId = body.results[0].id;
    }
  },
);
if (expectData) {
  await check('product page renders offers and JSON-LD', async () => {
    const r = await get(`${web}/en/product/${productId}`);
    const html = await r.text();
    assert(r.status === 200, `status ${r.status}`);
    assert(
      html.includes('application/ld+json') && html.includes('AggregateOffer'),
      'json-ld missing',
    );
    assert(html.includes('Cheapest'), 'price table missing');
  });
}
await check('search page survives repeated parameters (ZAP regression)', async () => {
  const r = await get(`${web}/en/search?q=milk&q=eggs&sort=price&sort=unit_price`);
  assert(r.status === 200, `status ${r.status}`);
});
await check('web: manifest, sitemap, robots, service worker, security.txt', async () => {
  for (const p of [
    '/manifest.webmanifest',
    '/sitemap.xml',
    '/robots.txt',
    '/sw.js',
    '/.well-known/security.txt',
  ]) {
    const r = await get(`${web}${p}`);
    assert(r.status === 200, `${p} -> ${r.status}`);
  }
});
await check('api: unauthenticated admin endpoints are refused', async () => {
  const r = await fetch(`${web}/api/v1/admin/sources`);
  assert(r.status === 401, `status ${r.status}`);
});
await check('api: OpenAPI is served and the docs UI is only for non-production', async () => {
  const r = await fetch(`${web}/api/v1/openapi.json`);
  const spec = await r.json();
  assert(Object.keys(spec.paths).length > 40, 'too few paths');
});
await check('admin console is never indexable or framable', async () => {
  const r = await get(`${admin}/`);
  assert(r.status === 200, `status ${r.status}`);
  assert((r.headers.get('x-robots-tag') ?? '').includes('noindex'), 'x-robots-tag');
  assert(r.headers.get('x-frame-options') === 'DENY', 'xfo');
});

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke test passed');
