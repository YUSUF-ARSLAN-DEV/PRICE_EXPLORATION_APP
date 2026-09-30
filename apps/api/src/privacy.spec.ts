import request from 'supertest';
import { SearchService } from './search/search.service';
import {
  PASSWORD,
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

describe('consents ledger', () => {
  it('appends a row per change, reports the latest state, and refuses to withdraw the terms', async () => {
    const { c } = await signUp(t);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'analytics', granted: true }] })
      .expect(200);
    const res = await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'analytics', granted: false }] })
      .expect(200);
    const analytics = res.body.consents.find((x: { purpose: string }) => x.purpose === 'analytics');
    expect(analytics.granted).toBe(false);
    const me = await c.get('/v1/me').expect(200);
    expect(
      me.body.consents.find((x: { purpose: string }) => x.purpose === 'account_terms').granted,
    ).toBe(true);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'account_terms', granted: false }] })
      .expect(400);
    const n = await t.db.one<{ n: string }>(
      `select count(*) as n from consents c join users u on u.id = c.user_id where u.email = $1 and c.purpose = 'analytics'`,
      [me.body.user.email],
    );
    expect(Number(n!.n)).toBe(2); // granted + withdrawn are both kept as proof
  });

  it('validates the purpose list', async () => {
    const { c } = await signUp(t);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'marketing', granted: true }] })
      .expect(422);
  });
});

describe('search history is opt-in', () => {
  it('records nothing without consent, records with consent, and clearing/withdrawing deletes it', async () => {
    const { c, email } = await signUp(t);
    const tag = uniq('hist');
    await c.get(`/v1/search?q=${tag}`).expect(200);
    expect((await c.get('/v1/me/history').expect(200)).body).toHaveLength(0);

    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'history', granted: true }] })
      .expect(200);
    await c.get(`/v1/search?q=${tag}`).expect(200);
    const h = await c.get('/v1/me/history').expect(200);
    expect(h.body).toHaveLength(1);
    expect(h.body[0].query).toBe(tag);

    await c.delete('/v1/me/history').expect(204);
    expect((await c.get('/v1/me/history')).body).toHaveLength(0);

    await c.get(`/v1/search?q=${tag}`).expect(200);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'history', granted: false }] })
      .expect(200);
    const left = await t.db.one<{ n: string }>(
      'select count(*) as n from search_history h join users u on u.id = h.user_id where u.email = $1',
      [email],
    );
    expect(Number(left!.n)).toBe(0);
  });

  it('anonymous aggregate search log holds no user or IP data', async () => {
    const tag = uniq('agg').replace(/\d/g, (d) => 'ghijklmnop'[Number(d)]!); // no digits: digit-heavy queries are (correctly) not logged
    await request(t.server).get(`/v1/search?q=${tag}`).expect(200);
    await t.app.get(SearchService).flushLog();
    const cols = await t.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'search_log' order by 1`,
    );
    expect(cols.map((x) => x.column_name)).toEqual(['day', 'hits', 'query_norm']);
    const row = await t.db.one<{ hits: number }>(
      'select hits from search_log where query_norm = $1',
      [tag],
    );
    expect(row!.hits).toBe(1);
  });

  it('does not log queries that look like personal data (emails, long numbers)', async () => {
    await request(t.server)
      .get('/v1/search?q=' + encodeURIComponent('someone@example.com'))
      .expect(200);
    await request(t.server)
      .get('/v1/search?q=' + encodeURIComponent('50123456789'))
      .expect(200);
    await t.app.get(SearchService).flushLog();
    // a normal query in the same batch proves the flush really happened
    await request(t.server).get('/v1/search?q=controlquery').expect(200);
    await t.app.get(SearchService).flushLog();
    expect(await t.db.one(`select 1 from search_log where query_norm = 'controlquery'`)).toBeDefined();
    const n = await t.db.one<{ n: string }>(
      `select count(*) as n from search_log where query_norm like '%example%' or query_norm like '%50123456789%'`,
    );
    expect(Number(n!.n)).toBe(0);
  });
});

describe('data-subject rights', () => {
  it('exports everything we hold about the user (and nothing about others)', async () => {
    const { c, email } = await signUp(t);
    const other = await signUp(t);
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id });
    const r = await mkRetailer(t);
    await mkOffer(t, p, r, 5);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'alerts_email', granted: true }] })
      .expect(200);
    await c
      .post('/v1/baskets')
      .send({ name: 'Weekly', items: [{ product_id: p.id, quantity: 2 }] })
      .expect(201);
    await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 4 }).expect(201);
    await other.c.post('/v1/baskets').send({ name: 'Other basket', items: [] }).expect(201);

    const res = await c.get('/v1/me/export').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const data = JSON.parse(res.text);
    expect(data.user.email).toBe(email);
    expect(data.consents.map((x: { purpose: string }) => x.purpose)).toEqual(
      expect.arrayContaining(['account_terms', 'alerts_email']),
    );
    expect(data.baskets).toHaveLength(1);
    expect(data.baskets[0].items[0]).toMatchObject({ product_id: p.id, quantity: 2 });
    expect(data.alerts).toHaveLength(1);
    expect(res.text).not.toContain(other.email);
    expect(res.text).not.toMatch(/pw_hash|argon2/);
  });

  it('erases the account: needs the password, anonymises, deletes content, blocks login and sessions', async () => {
    const { c, email } = await signUp(t);
    await c.post('/v1/baskets').send({ name: 'Mine', items: [] }).expect(201);
    await c.delete('/v1/me').send({ password: 'wrong-password-1' }).expect(403);
    await c.delete('/v1/me').send({ password: PASSWORD }).expect(204);

    await c.get('/v1/me').expect(401);
    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    const gone = await t.db.one('select 1 from users where email = $1', [email]);
    expect(gone).toBeUndefined();
    const tomb = await t.db.query<{ email: string; pw_hash: string; deleted_at: Date }>(
      `select email::text as email, pw_hash, deleted_at from users where email like 'erased-%' order by deleted_at desc limit 1`,
    );
    expect(tomb[0]!.pw_hash).toBe('');
    expect(tomb[0]!.deleted_at).toBeTruthy();
    // the address can be registered again afterwards
    await request(t.server)
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, acceptTerms: true })
      .expect(202);
    const fresh = await t.db.one('select 1 from users where email = $1 and deleted_at is null', [
      email,
    ]);
    expect(fresh).toBeDefined();
  });
});
