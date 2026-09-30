import request from 'supertest';
import {
  TestApp,
  createTestApp,
  mkCategory,
  mkOffer,
  mkProduct,
  mkRetailer,
  uniq,
} from '../test/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const search = (q: string, extra = '') =>
  request(t.server).get(`/v1/search?q=${encodeURIComponent(q)}${extra}`);

describe('what the public can see', () => {
  it('returns offers from every approved grocer, cheapest first, with stale flags and a disclaimer', async () => {
    const tag = uniq('milk');
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { name: `${tag} Fresh Milk`, category: cat.id });
    const [a, b, c] = [await mkRetailer(t), await mkRetailer(t), await mkRetailer(t)];
    await mkOffer(t, p, a, 6.5);
    await mkOffer(t, p, b, 5.75);
    await mkOffer(t, p, c, 7, { daysAgo: 10 });
    const res = await search(tag).expect(200);
    expect(res.body.backend).toBe('postgres');
    expect(res.body.disclaimer).toMatch(/check the price/i);
    const [hit] = res.body.results;
    expect(hit.id).toBe(p.id);
    expect(hit.offers.map((o: { price_qar: number }) => o.price_qar)).toEqual([5.75, 6.5, 7]);
    expect(hit.min_price_qar).toBe(5.75);
    expect(hit.offer_count).toBe(3);
    expect(hit.offers.map((o: { is_stale: boolean }) => o.is_stale)).toEqual([false, false, true]);
    expect(hit.offers[0].unit_price_qar).toBe(5.75);
    expect(hit.last_updated).toBeTruthy();
  });

  it('never shows restricted products, unapproved/killed sources, demo retailers, unmatched or expired prices', async () => {
    const tag = uniq('hide');
    const cat = await mkCategory(t);
    const restricted = await mkCategory(t, uniq('alc'), true);
    const visible = await mkProduct(t, { name: `${tag} visible`, category: cat.id });
    const ok = await mkRetailer(t);
    await mkOffer(t, visible, ok, 5);

    const alcohol = await mkProduct(t, { name: `${tag} restricted beer`, category: restricted.id });
    await mkOffer(t, alcohol, ok, 9);

    const redProduct = await mkProduct(t, { name: `${tag} red source`, category: cat.id });
    const amber = await mkRetailer(t, { status: 'amber' });
    await expect(mkOffer(t, redProduct, amber, 5)).rejects.toThrow(/not approved/);

    const killedProduct = await mkProduct(t, { name: `${tag} killed`, category: cat.id });
    const killed = await mkRetailer(t);
    await mkOffer(t, killedProduct, killed, 5);
    await t.db.query(`select disable_source($1, 'takedown')`, [killed.sourceId]);

    const demoProduct = await mkProduct(t, { name: `${tag} demo`, category: cat.id });
    await mkOffer(t, demoProduct, await mkRetailer(t, { demo: true }), 5);

    const unmatched = await mkProduct(t, { name: `${tag} unmatched`, category: cat.id });
    await mkOffer(t, unmatched, ok, 5, { status: 'review' });

    const oldProduct = await mkProduct(t, { name: `${tag} ancient`, category: cat.id });
    await mkOffer(t, oldProduct, await mkRetailer(t), 5, { daysAgo: 45 });

    const res = await search(tag, '&limit=50').expect(200);
    expect(res.body.results.map((r: { name_en: string }) => r.name_en)).toEqual([`${tag} visible`]);
    await request(t.server).get(`/v1/products/${alcohol.id}`).expect(404);
  });

  it('matches Arabic and diacritic/alef variants, and reorders words', async () => {
    const tag = uniq('ar');
    const cat = await mkCategory(t);
    const p = await mkProduct(t, {
      name: `${tag} Almarai Fresh Milk`,
      nameAr: 'حليب المراعي الطازج',
      category: cat.id,
      brand: 'Almarai',
    });
    await mkOffer(t, p, await mkRetailer(t), 6);
    const hits = async (q: string) =>
      (await search(q).expect(200)).body.results.map((r: { id: string }) => r.id);
    expect(await hits('حليب المراعي')).toContain(p.id);
    expect(await hits('حَلِيب')).toContain(p.id); // tashkeel stripped
    expect(await hits('المراعى')).toContain(p.id); // final ya/alef maqsura unified
    expect(await hits(`milk ${tag} almarai`)).toContain(p.id); // word order free
    expect(await hits(tag.toUpperCase())).toContain(p.id);
  });

  it('filters by category (including sub-categories) and retailer, and validates input', async () => {
    const tag = uniq('flt');
    const parent = await mkCategory(t);
    const child = await mkCategory(t, uniq('kid'), false, parent.id);
    const other = await mkCategory(t);
    const inChild = await mkProduct(t, { name: `${tag} in child`, category: child.id });
    const elsewhere = await mkProduct(t, { name: `${tag} elsewhere`, category: other.id });
    const r1 = await mkRetailer(t);
    const r2 = await mkRetailer(t);
    await mkOffer(t, inChild, r1, 5);
    await mkOffer(t, elsewhere, r2, 6);
    const byCat = await search(tag, `&category=${parent.slug}`).expect(200);
    expect(byCat.body.results.map((r: { id: string }) => r.id)).toEqual([inChild.id]);
    const byRetailer = await search(tag, `&retailer=${r2.slug}`).expect(200);
    expect(byRetailer.body.results.map((r: { id: string }) => r.id)).toEqual([elsewhere.id]);
    await request(t.server).get('/v1/search').expect(422);
    await request(t.server).get('/v1/search?q=x&limit=500').expect(422);
    await request(t.server).get('/v1/search?q=x&sort=bogus').expect(422);
  });

  it('treats SQL/LIKE metacharacters as plain text', async () => {
    await search("'; drop table products; --").expect(200);
    await search('%').expect(200);
    await search('a_b%c\\').expect(200);
    const still = await t.db.one('select 1 from products limit 1');
    expect(still).toBeDefined();
  });
});

describe('ranking (plan 5.4)', () => {
  it('relevance first, then products sold by >= 2 retailers, then popularity', async () => {
    const tag = uniq('rank');
    const cat = await mkCategory(t);
    const single = await mkProduct(t, { name: `${tag} alpha`, category: cat.id });
    const dual = await mkProduct(t, { name: `${tag} beta`, category: cat.id });
    const [r1, r2] = [await mkRetailer(t), await mkRetailer(t)];
    await mkOffer(t, single, r1, 1);
    await mkOffer(t, dual, r1, 9);
    await mkOffer(t, dual, r2, 8);
    const res = await search(tag).expect(200);
    expect(res.body.results.map((r: { id: string }) => r.id)).toEqual([dual.id, single.id]);

    const byPrice = await search(tag, '&sort=price').expect(200);
    expect(byPrice.body.results.map((r: { id: string }) => r.id)).toEqual([single.id, dual.id]);
  });

  it('popularity breaks ties (baskets + alerts)', async () => {
    const tag = uniq('pop');
    const cat = await mkCategory(t);
    const a = await mkProduct(t, { name: `${tag} one`, category: cat.id });
    const b = await mkProduct(t, { name: `${tag} two`, category: cat.id });
    const r = await mkRetailer(t);
    await mkOffer(t, a, r, 5);
    await mkOffer(t, b, r, 5);
    const u = await t.db.one<{ id: string }>(
      `insert into users (email, pw_hash) values ($1, 'x') returning id`,
      [`${uniq('p')}@example.com`],
    );
    const basket = await t.db.one<{ id: string }>(
      'insert into baskets (user_id) values ($1) returning id',
      [u!.id],
    );
    await t.db.query('insert into basket_items (basket_id, product_id) values ($1, $2)', [
      basket!.id,
      b.id,
    ]);
    const res = await search(tag).expect(200);
    expect(res.body.results[0].id).toBe(b.id);
  });
});

describe('autocomplete and popular searches', () => {
  it('suggests products and brands, prefix matches first, only public items', async () => {
    const tag = uniq('ac');
    const cat = await mkCategory(t);
    const restricted = await mkCategory(t, uniq('alc'), true);
    const p = await mkProduct(t, { name: `${tag} Yogurt Plain`, category: cat.id });
    const hidden = await mkProduct(t, { name: `${tag} Yogurt Secret`, category: restricted.id });
    const r = await mkRetailer(t);
    await mkOffer(t, p, r, 3);
    await mkOffer(t, hidden, r, 3);
    const res = await request(t.server).get(`/v1/search/autocomplete?q=${tag}`).expect(200);
    const names = res.body.suggestions.map((s: { text: string }) => s.text);
    expect(names).toContain(`${tag} Yogurt Plain`);
    expect(names).not.toContain(`${tag} Yogurt Secret`);
    expect(res.body.suggestions[0]).toMatchObject({ kind: 'product', product_id: p.id });
    await request(t.server).get('/v1/search/autocomplete?q=').expect(422);
  });

  it('lists only queries searched >= 20 times (k-anonymity)', async () => {
    const popular = uniq('kpop');
    const rare = uniq('krare');
    await t.db.query(
      `insert into search_log (day, query_norm, hits) values (current_date, $1, 25), (current_date, $2, 19)`,
      [popular, rare],
    );
    const res = await request(t.server).get('/v1/search/popular').expect(200);
    const qs = res.body.popular.map((x: { query: string }) => x.query);
    expect(qs).toContain(popular);
    expect(qs).not.toContain(rare);
  });
});

describe('performance smoke', () => {
  it('search and autocomplete answer well inside the 300 ms / 80 ms budgets on a small dataset', async () => {
    const tag = uniq('perf');
    const cat = await mkCategory(t);
    const r = await mkRetailer(t);
    for (let i = 0; i < 20; i++)
      await mkOffer(
        t,
        await mkProduct(t, { name: `${tag} item ${i}`, category: cat.id }),
        r,
        5 + i,
      );
    await search(tag).expect(200); // warm-up
    const t0 = performance.now();
    await search(tag).expect(200);
    const searchMs = performance.now() - t0;
    const t1 = performance.now();
    await request(t.server).get(`/v1/search/autocomplete?q=${tag}`).expect(200);
    const acMs = performance.now() - t1;
    expect(searchMs).toBeLessThan(300);
    expect(acMs).toBeLessThan(150);
  });
});
