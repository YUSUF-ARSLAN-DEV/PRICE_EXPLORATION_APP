/**
 * Meilisearch backend (plan 5.1). Runs only when a Meilisearch is reachable
 * (docker compose up meilisearch); CI provides one via MEILI_TEST_URL.
 */
import http from 'node:http';
import request from 'supertest';
import { MeiliIndexer } from './search/meili.indexer';
import {
  TestApp,
  createTestApp,
  mkCategory,
  mkOffer,
  mkProduct,
  mkRetailer,
  uniq,
} from '../test/app';

const URL_ = process.env.MEILI_TEST_URL ?? 'http://localhost:7700';
const KEY = process.env.MEILI_TEST_KEY ?? 'local_master_key_change_me_32chars_min';

const reachable = await_(
  () =>
    new Promise<boolean>((resolve) => {
      const req = http.get(`${URL_}/health`, (res) => resolve(res.statusCode === 200));
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    }),
);
function await_<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

let t: TestApp;
let up = false;
beforeAll(async () => {
  up = await reachable;
  if (!up) return;
  process.env.MEILI_URL = URL_;
  process.env.MEILI_MASTER_KEY = KEY;
  process.env.MEILI_INDEX = uniq('test_products_');
  t = await createTestApp();
});
afterAll(async () => {
  if (!up) return;
  const idx = t.app.get(MeiliIndexer);
  await idx.client!.deleteIndex(process.env.MEILI_INDEX!).catch(() => undefined);
  await t.close();
  delete process.env.MEILI_URL;
  delete process.env.MEILI_INDEX;
});

const itMeili = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!up) return console.warn('Meilisearch not reachable: skipping');
    await fn();
  });

itMeili(
  'indexes only public products and serves search from Meilisearch with the same response shape',
  async () => {
    const tag = uniq('mx').replace(/\d/g, 'q');
    const cat = await mkCategory(t);
    const restricted = await mkCategory(t, uniq('alc'), true);
    const a = await mkProduct(t, { name: `${tag} Fresh Milk`, category: cat.id });
    const hidden = await mkProduct(t, { name: `${tag} Restricted Beer`, category: restricted.id });
    const r1 = await mkRetailer(t);
    const r2 = await mkRetailer(t);
    await mkOffer(t, a, r1, 6.5);
    await mkOffer(t, a, r2, 5.5);
    await mkOffer(t, hidden, r1, 9);
    const n = await t.app.get(MeiliIndexer).reindex();
    expect(n).toBeGreaterThanOrEqual(1);

    const res = await request(t.server).get(`/v1/search?q=${tag}`).expect(200);
    expect(res.body.backend).toBe('meilisearch');
    expect(res.body.results.map((r: { id: string }) => r.id)).toEqual([a.id]);
    expect(res.body.results[0].offers.map((o: { price_qar: number }) => o.price_qar)).toEqual([
      5.5, 6.5,
    ]);
    expect(res.body.disclaimer).toBeTruthy();
  },
);

itMeili('typo tolerance, Arabic synonyms, and category/retailer filters', async () => {
  const cat = await mkCategory(t);
  const other = await mkCategory(t);
  const r1 = await mkRetailer(t);
  const r2 = await mkRetailer(t);
  const tag = uniq('sy').replace(/\d/g, 'z');
  const rice = await mkProduct(t, { name: `${tag} Rice Basmati`, category: cat.id });
  const elsewhere = await mkProduct(t, { name: `${tag} Rice Jasmine`, category: other.id });
  await mkOffer(t, rice, r1, 20);
  await mkOffer(t, elsewhere, r2, 22);
  await t.app.get(MeiliIndexer).reindex();

  const ids = async (q: string, extra = '') =>
    (
      await request(t.server)
        .get(`/v1/search?q=${encodeURIComponent(q)}${extra}`)
        .expect(200)
    ).body.results.map((r: { id: string }) => r.id);
  expect(await ids(`${tag} basmti`)).toContain(rice.id); // typo
  expect(await ids(`${tag} رز`)).toEqual(expect.arrayContaining([rice.id, elsewhere.id])); // synonym: رز = rice
  expect(await ids(`${tag} rice`, `&category=${cat.slug}`)).toEqual([rice.id]);
  expect(await ids(`${tag} rice`, `&retailer=${r2.slug}`)).toEqual([elsewhere.id]);
});

itMeili('prices always come from the database, never from the index', async () => {
  const tag = uniq('live').replace(/\d/g, 'k');
  const cat = await mkCategory(t);
  const p = await mkProduct(t, { name: `${tag} Item`, category: cat.id });
  const r = await mkRetailer(t);
  const rp = await mkOffer(t, p, r, 10);
  await t.app.get(MeiliIndexer).reindex();
  await t.db.query(`select record_price($1, null, 7.25, null, 'none', null, true, now(), $2)`, [
    rp,
    r.sourceId,
  ]);
  const res = await request(t.server).get(`/v1/search?q=${tag}`).expect(200);
  expect(res.body.results[0].offers[0].price_qar).toBe(7.25); // index still says 10
  await t.db.query(`select disable_source($1, 'takedown')`, [r.sourceId]);
  const after = await request(t.server).get(`/v1/search?q=${tag}`).expect(200);
  expect(after.body.results).toHaveLength(0); // killed source vanishes even before a re-index
});

it('falls back to Postgres when Meilisearch is down', async () => {
  process.env.MEILI_URL = 'http://127.0.0.1:1'; // nothing listens here
  const local = await createTestApp();
  try {
    const tag = uniq('fb').replace(/\d/g, 'w');
    const cat = await mkCategory(local);
    const p = await mkProduct(local, { name: `${tag} Fallback`, category: cat.id });
    await mkOffer(local, p, await mkRetailer(local), 4);
    const res = await request(local.server).get(`/v1/search?q=${tag}`).expect(200);
    expect(res.body.backend).toBe('postgres');
    expect(res.body.results[0].id).toBe(p.id);
  } finally {
    await local.close();
    if (up) process.env.MEILI_URL = URL_;
    else delete process.env.MEILI_URL;
  }
});
