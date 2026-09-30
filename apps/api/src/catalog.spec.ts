import request from 'supertest';
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

describe('catalogue endpoints', () => {
  it('lists retailers that have public prices (no demo, no killed sources) and respects logo licensing', async () => {
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id });
    const live = await mkRetailer(t, { name: uniq('Live') });
    const killed = await mkRetailer(t, { name: uniq('Killed') });
    const demo = await mkRetailer(t, { name: uniq('Demo'), demo: true });
    for (const r of [live, killed, demo]) await mkOffer(t, p, r, 5);
    await t.db.query(`select disable_source($1, 'x')`, [killed.sourceId]);
    const res = await request(t.server).get('/v1/retailers').expect(200);
    const slugs = res.body.retailers.map((r: { slug: string }) => r.slug);
    expect(slugs).toContain(live.slug);
    expect(slugs).not.toContain(killed.slug);
    expect(slugs).not.toContain(demo.slug);
    expect(res.body.retailers.find((r: { slug: string }) => r.slug === live.slug).show_logo).toBe(
      false,
    );
  });

  it('never lists restricted categories', async () => {
    const restricted = await mkCategory(t, uniq('alc'), true);
    const open = await mkCategory(t);
    const res = await request(t.server).get('/v1/categories').expect(200);
    const slugs = res.body.categories.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain(open.slug);
    expect(slugs).not.toContain(restricted.slug);
    expect(slugs).not.toContain('restricted-alcohol-tobacco');
    expect(slugs).not.toContain('restricted-pork');
  });

  it('product page: offers, 90-day history (daily minimum per retailer), 404s and 400s', async () => {
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id, name: uniq('Hist') });
    const r = await mkRetailer(t);
    const rp = await mkOffer(t, p, r, 6, { daysAgo: 30 });
    await t.db.query(
      `select record_price($1, null, 5.5, null, 'none', null, true, now() - interval '10 days', $2)`,
      [rp, r.sourceId],
    );
    await t.db.query(
      `select record_price($1, null, 5.0, null, 'none', null, true, now() - interval '10 days' + interval '1 hour', $2)`,
      [rp, r.sourceId],
    );
    await t.db.query(
      `select record_price($1, null, 7.0, null, 'none', null, true, now() - interval '100 days', $2)`,
      [rp, r.sourceId],
    );
    const res = await request(t.server).get(`/v1/products/${p.id}`).expect(200);
    expect(res.body.product.id).toBe(p.id);
    expect(res.body.disclaimer).toBeTruthy();
    const prices = res.body.history.map((h: { min_price_qar: number }) => h.min_price_qar);
    expect(prices).toEqual([6, 5]); // 30 days ago: 6 ; 10 days ago: min(5.5, 5.0) ; the 100-day-old point is outside the window
    await request(t.server).get('/v1/products/00000000-0000-4000-8000-000000000000').expect(404);
    await request(t.server).get('/v1/products/not-a-uuid').expect(400);
  });

  it('offers: only real promotions, biggest discount first, expired promos dropped', async () => {
    const cat = await mkCategory(t);
    const r = await mkRetailer(t);
    const big = await mkProduct(t, { category: cat.id, name: uniq('Big') });
    const small = await mkProduct(t, { category: cat.id, name: uniq('Small') });
    const plain = await mkProduct(t, { category: cat.id, name: uniq('Plain') });
    const expired = await mkProduct(t, { category: cat.id, name: uniq('Expired') });
    await mkOffer(t, big, r, 5, { was: 10 });
    await mkOffer(t, small, r, 9, { was: 10 });
    await mkOffer(t, plain, r, 4);
    const rp = await mkOffer(t, expired, r, 4, { was: 8 });
    await t.db.query(
      `update current_prices set promo_ends_at = now() - interval '1 day' where retailer_product_id = $1`,
      [rp],
    );
    const res = await request(t.server).get(`/v1/offers?retailer=${r.slug}`).expect(200);
    expect(res.body.offers.map((o: { name_en: string }) => o.name_en)).toEqual([
      big.name,
      small.name,
    ]);
    expect(res.body.offers[0].was_price_qar).toBe(10);
  });

  it('sitemap lists only public products', async () => {
    const cat = await mkCategory(t);
    const restricted = await mkCategory(t, uniq('alc'), true);
    const pub = await mkProduct(t, { category: cat.id });
    const hid = await mkProduct(t, { category: restricted.id });
    const r = await mkRetailer(t);
    await mkOffer(t, pub, r, 5);
    await mkOffer(t, hid, r, 5);
    const ids = (await request(t.server).get('/v1/sitemap').expect(200)).body.products.map(
      (p: { id: string }) => p.id,
    );
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(hid.id);
  });
});

describe('baskets', () => {
  const setup = async () => {
    const cat = await mkCategory(t);
    const milk = await mkProduct(t, { category: cat.id, name: uniq('bm') });
    const rice = await mkProduct(t, { category: cat.id, name: uniq('br') });
    const [a, b] = [await mkRetailer(t), await mkRetailer(t)];
    await mkOffer(t, milk, a, 6);
    await mkOffer(t, milk, b, 5);
    await mkOffer(t, rice, a, 30);
    await mkOffer(t, rice, b, 32);
    return { milk, rice, a, b };
  };

  it('optimises anonymously: per-store totals, best single store and best split', async () => {
    const { milk, rice, a, b } = await setup();
    const res = await request(t.server)
      .post('/v1/baskets/optimise')
      .send({ items: [{ product_id: milk.id, quantity: 10 }, { product_id: rice.id }] })
      .expect(200);
    const totals = Object.fromEntries(
      res.body.stores.map((s: { retailer_id: string; total_qar: number }) => [
        s.retailer_id,
        s.total_qar,
      ]),
    );
    expect(totals).toMatchObject({ [a.id]: 90, [b.id]: 82 });
    expect(res.body.best_single.retailer_id).toBe(b.id);
    expect(res.body.best_split.total_qar).toBe(80);
    const noSplit = await request(t.server)
      .post('/v1/baskets/optimise')
      .send({
        items: [{ product_id: milk.id, quantity: 10 }, { product_id: rice.id }],
        allow_split: false,
      })
      .expect(200);
    expect(noSplit.body.best_split).toBeNull();
  });

  it('ignores hidden products and validates input', async () => {
    const restricted = await mkCategory(t, uniq('alc'), true);
    const hidden = await mkProduct(t, { category: restricted.id });
    await mkOffer(t, hidden, await mkRetailer(t), 5);
    const res = await request(t.server)
      .post('/v1/baskets/optimise')
      .send({ items: [{ product_id: hidden.id }] })
      .expect(200);
    expect(res.body.unavailable_product_ids).toEqual([hidden.id]);
    await request(t.server).post('/v1/baskets/optimise').send({ items: [] }).expect(422);
    await request(t.server)
      .post('/v1/baskets/optimise')
      .send({ items: [{ product_id: 'nope' }] })
      .expect(422);
    await request(t.server)
      .post('/v1/baskets/optimise')
      .send({ items: [{ product_id: hidden.id, quantity: -1 }] })
      .expect(422);
  });

  it('saved baskets: CRUD for the owner only', async () => {
    const { milk, rice } = await setup();
    const alice = await signUp(t);
    const bob = await signUp(t);
    const created = await alice.c
      .post('/v1/baskets')
      .send({
        name: 'Weekly',
        items: [
          { product_id: milk.id, quantity: 2 },
          { product_id: milk.id, quantity: 1 },
        ],
      })
      .expect(201);
    const id = created.body.id;
    const list = await alice.c.get('/v1/baskets').expect(200);
    expect(list.body.baskets[0].items).toEqual([{ product_id: milk.id, quantity: 3 }]); // duplicates merged
    await alice.c
      .put(`/v1/baskets/${id}`)
      .send({ name: 'Monthly', items: [{ product_id: rice.id }] })
      .expect(200);
    await bob.c.put(`/v1/baskets/${id}`).send({ name: 'hijack', items: [] }).expect(404);
    await bob.c.delete(`/v1/baskets/${id}`).expect(404);
    expect((await bob.c.get('/v1/baskets')).body.baskets).toHaveLength(0);
    await alice.c.delete(`/v1/baskets/${id}`).expect(204);
    await request(t.server).get('/v1/baskets').expect(401);
  });
});
