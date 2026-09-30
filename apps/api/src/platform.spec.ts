import request from 'supertest';
import { truncateIp } from './common/net';
import { loadConfig } from './config';
import {
  TestApp,
  createTestApp,
  mkCategory,
  mkOffer,
  mkProduct,
  mkRetailer,
  signUp,
  uniq,
} from '../test/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('errors are RFC 7807 problem documents that never leak internals', () => {
  it('404 for unknown routes, 400 for bad ids, 422 for validation', async () => {
    const nf = await request(t.server).get('/v1/nope').expect(404);
    expect(nf.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(nf.body).toMatchObject({ status: 404, title: 'Not Found', instance: '/v1/nope' });
    await request(t.server).get('/v1/products/xyz').expect(400);
    const bad = await request(t.server).post('/v1/auth/login').send({ email: 'x' }).expect(422);
    expect(bad.body.errors[0]).toHaveProperty('path');
  });

  it('a database failure is a generic 500 with no SQL, table names or stack in the body', async () => {
    const spy = jest
      .spyOn(t.db, 'query')
      .mockRejectedValueOnce(
        Object.assign(new Error('relation "secret_table" does not exist'), { code: '42P01' }),
      );
    const res = await request(t.server).get('/v1/categories').expect(500);
    spy.mockRestore();
    expect(JSON.stringify(res.body)).not.toMatch(/secret_table|SELECT|select|stack/i);
    expect(res.body).toMatchObject({ status: 500, detail: 'Unexpected error' });
  });
});

describe('idempotency keys (plan 6.8)', () => {
  it('replays the first response for the same key and route; other routes/short keys are refused', async () => {
    const { c } = await signUp(t);
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id });
    await mkOffer(t, p, await mkRetailer(t), 5);
    const key = uniq('idem') + '-key';
    const body = { name: 'Once', items: [{ product_id: p.id }] };
    const first = await c.post('/v1/baskets').set('Idempotency-Key', key).send(body).expect(201);
    const second = await c.post('/v1/baskets').set('Idempotency-Key', key).send(body).expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect((await c.get('/v1/baskets')).body.baskets).toHaveLength(1);
    await c.post('/v1/reports').set('Idempotency-Key', key).send({ product_id: p.id }).expect(422); // same key, different route
    await c.post('/v1/baskets').set('Idempotency-Key', 'short').send(body).expect(422);
  });

  it('keys are scoped per user', async () => {
    const [a, b] = [await signUp(t), await signUp(t)];
    const key = uniq('scope') + '-key';
    const r1 = await a.c
      .post('/v1/baskets')
      .set('Idempotency-Key', key)
      .send({ name: 'A', items: [] })
      .expect(201);
    const r2 = await b.c
      .post('/v1/baskets')
      .set('Idempotency-Key', key)
      .send({ name: 'B', items: [] })
      .expect(201);
    expect(r1.body.id).not.toBe(r2.body.id);
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(t.server).get('/v1/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.body).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('CORS: allowed origins get credentialed access, others get nothing', async () => {
    const ok = await request(t.server)
      .options('/v1/me')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'PATCH')
      .expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-allow-headers']).toMatch(/X-Qarib-CSRF/i);
    const bad = await request(t.server)
      .options('/v1/me')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized JSON bodies', async () => {
    const big = { email: 'a@b.co', password: 'x'.repeat(300_000) };
    await request(t.server).post('/v1/auth/login').send(big).expect(413);
  });
});

describe('OpenAPI contract (plan 6.1)', () => {
  it('publishes a spec covering the public surface with request schemas', async () => {
    const spec = (await request(t.server).get('/v1/openapi.json').expect(200)).body;
    const paths = Object.keys(spec.paths);
    for (const p of [
      '/v1/search',
      '/v1/search/autocomplete',
      '/v1/search/popular',
      '/v1/products/{id}',
      '/v1/retailers',
      '/v1/categories',
      '/v1/offers',
      '/v1/baskets/optimise',
      '/v1/auth/register',
      '/v1/auth/login',
      '/v1/me',
      '/v1/me/export',
      '/v1/me/consents',
      '/v1/alerts',
      '/v1/reports',
      '/v1/takedown',
      '/v1/admin/sources/{id}/kill-switch',
      '/v1/health',
    ])
      expect(paths).toContain(p);
    const reg = spec.paths['/v1/auth/register'].post.requestBody.content['application/json'].schema;
    expect(reg.properties).toHaveProperty('acceptTerms');
    const search = spec.paths['/v1/search'].get.parameters.map((x: { name: string }) => x.name);
    expect(search).toEqual(expect.arrayContaining(['q', 'lang', 'sort', 'limit']));
  });
});

describe('rate limiting and privacy helpers', () => {
  it('truncates IPv4 to /24 and IPv6 to /48 for storage and logs', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0');
    expect(truncateIp('::ffff:203.0.113.77')).toBe('203.0.113.0');
    expect(truncateIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::');
    expect(truncateIp(undefined)).toBeNull();
  });

  it('refuses unsafe production configuration', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(40),
        SHOW_DEMO: 'true',
      } as NodeJS.ProcessEnv),
    ).toThrow(/SHOW_DEMO/);
    const prod = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
    } as NodeJS.ProcessEnv);
    expect(prod.cookieSecure).toBe(true);
    expect(prod.swaggerUi).toBe(false);
  });

  it('the access log contains no query strings, cookies or emails', async () => {
    const lines: string[] = [];
    const { Logger } = await import('@nestjs/common');
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((m: unknown) => void lines.push(String(m)));
    await request(t.server)
      .get('/v1/search?q=secret-query-text')
      .set('Cookie', 'qarib_at=secret-cookie')
      .expect(200);
    spy.mockRestore();
    const line = lines.find((l) => l.includes('/v1/search'))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/secret-query-text|secret-cookie|@/);
    expect(JSON.parse(line)).toMatchObject({ method: 'GET', path: '/v1/search', status: 200 });
  });
});
