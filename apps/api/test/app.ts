import { randomBytes } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { Db } from '../src/db/db.service';
import { Mailer, MemoryMailer } from '../src/mail/mailer';

export interface TestApp {
  app: NestExpressApplication;
  db: Db;
  mailer: MemoryMailer;
  server: ReturnType<NestExpressApplication['getHttpServer']>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useClass(MemoryMailer)
    .compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  await configureApp(app);
  await app.init();
  return {
    app,
    db: app.get(Db),
    mailer: app.get(Mailer) as MemoryMailer,
    server: app.getHttpServer(),
    close: () => app.close(),
  };
}

export const uniq = (p = 'x') => `${p}${randomBytes(4).toString('hex')}`;
export const PASSWORD = 'correct-horse-9battery';

/** A cookie-carrying client that sends the CSRF header on state-changing requests. */
export function client(t: TestApp) {
  const agent = request.agent(t.server);
  const wrap = (method: 'post' | 'put' | 'patch' | 'delete') => (url: string) =>
    agent[method](url).set('x-qarib-csrf', '1');
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: wrap('post'),
    put: wrap('put'),
    patch: wrap('patch'),
    delete: wrap('delete'),
  };
}
export type Client = ReturnType<typeof client>;

/** Register + verify + login. Returns the signed-in client and the user's email. */
export async function signUp(t: TestApp, opts: { email?: string; admin?: boolean } = {}) {
  const email = opts.email ?? `${uniq('u')}@example.com`;
  const c = client(t);
  await c
    .post('/v1/auth/register')
    .send({ email, password: PASSWORD, acceptTerms: true })
    .expect(202);
  await c
    .post('/v1/auth/verify-email')
    .send({ token: t.mailer.tokenFrom(email) })
    .expect(204);
  if (opts.admin) await t.db.query(`update users set role = 'admin' where email = $1`, [email]);
  await c.post('/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { c, email };
}

// ---- data builders (plain SQL so tests do not depend on the ingestion code) ------------------
export async function mkCategory(
  t: TestApp,
  slug = uniq('cat'),
  restricted = false,
  parent: string | null = null,
) {
  const r = await t.db.one<{ id: string }>(
    `insert into categories (slug, name_en, name_ar, restricted, parent_id) values ($1, $1, $1, $2, $3) returning id`,
    [slug, restricted, parent],
  );
  return { id: r!.id, slug };
}

export async function mkRetailer(
  t: TestApp,
  opts: { name?: string; demo?: boolean; status?: string; method?: string } = {},
) {
  const slug = uniq('ret');
  const r = await t.db.one<{ id: string }>(
    `insert into retailers (slug, name_en, name_ar, type, is_demo) values ($1, $2, $2, 'supermarket', $3) returning id`,
    [slug, opts.name ?? `Retailer ${slug}`, opts.demo ?? false],
  );
  const s = await t.db.one<{ id: string }>(
    `insert into sources (retailer_id, method, legal_status, approval_ref) values ($1, $2::source_method, $3::legal_status, 'test') returning id`,
    [r!.id, opts.method ?? 'partner_feed', opts.status ?? 'green'],
  );
  return { id: r!.id, slug, sourceId: s!.id };
}

export async function mkProduct(
  t: TestApp,
  opts: {
    name?: string;
    nameAr?: string;
    category?: string;
    size?: [number, string, number] | null;
    brand?: string;
  } = {},
) {
  const category = opts.category ?? (await mkCategory(t)).id;
  const name = opts.name ?? `Product ${uniq()}`;
  const norm = `${name} ${opts.nameAr ?? ''} ${opts.brand ?? ''}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  let brandId: string | null = null;
  if (opts.brand) {
    const b = await t.db.one<{ id: string }>(
      `insert into brands (name_en) values ($1) on conflict (name_en) do update set name_en = excluded.name_en returning id`,
      [opts.brand],
    );
    brandId = b!.id;
  }
  const size = opts.size === undefined ? [1, 'l', 1] : opts.size;
  const p = await t.db.one<{ id: string }>(
    `insert into products (canonical_name_en, canonical_name_ar, brand_id, category_id, size_value, size_unit, pack_count, search_text)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      name,
      opts.nameAr ?? null,
      brandId,
      category,
      size?.[0] ?? null,
      size?.[1] ?? null,
      size?.[2] ?? 1,
      norm,
    ],
  );
  return { id: p!.id, name };
}

/** Listing + price for (product, retailer). `daysAgo` ages the observation. */
export async function mkOffer(
  t: TestApp,
  product: { id: string },
  retailer: { id: string; sourceId: string },
  price: number,
  opts: { daysAgo?: number; was?: number; status?: string } = {},
) {
  const rp = await t.db.one<{ id: string }>(
    `insert into retailer_products (retailer_id, source_id, external_sku, raw_name, product_id, match_status)
     values ($1, $2, $3, 'raw', $4, $5::match_status) returning id`,
    [retailer.id, retailer.sourceId, uniq('sku'), product.id, opts.status ?? 'manual'],
  );
  await t.db.query(
    `select record_price($1, null, $2::numeric, $3::numeric, $4::promo_type, null, true, now() - make_interval(days => $5::int), $6)`,
    [
      rp!.id,
      price,
      opts.was ?? null,
      opts.was ? 'discount' : 'none',
      opts.daysAgo ?? 0,
      retailer.sourceId,
    ],
  );
  return rp!.id;
}
