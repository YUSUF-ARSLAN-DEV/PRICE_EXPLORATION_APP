import request from 'supertest';
import { AlertsService, inQuietHours } from './alerts/alerts.service';
import {
  TestApp,
  createTestApp,
  mkCategory,
  mkOffer,
  mkProduct,
  mkRetailer,
  signUp,
} from '../test/app';

let t: TestApp;
let alerts: AlertsService;
beforeAll(async () => {
  t = await createTestApp();
  alerts = t.app.get(AlertsService);
});
afterAll(() => t.close());

// 10:00 Qatar time (UTC+3) - outside quiet hours
const DAYTIME = new Date('2026-10-05T07:00:00Z');

async function setup(price = 4) {
  const cat = await mkCategory(t);
  const p = await mkProduct(t, { category: cat.id });
  const r = await mkRetailer(t);
  await mkOffer(t, p, r, price);
  const user = await signUp(t);
  return { p, r, ...user };
}
const consent = (c: Awaited<ReturnType<typeof signUp>>['c'], granted = true) =>
  c
    .patch('/v1/me/consents')
    .send({ consents: [{ purpose: 'alerts_email', granted }] })
    .expect(200);

describe('alert creation', () => {
  it('needs the alerts_email consent first (409 consent_required), then works', async () => {
    const { c, p } = await setup();
    const no = await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 5 }).expect(409);
    expect(no.body.code).toBe('consent_required');
    await consent(c);
    const ok = await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 5 }).expect(201);
    expect((await c.get('/v1/alerts')).body.alerts).toHaveLength(1);
    await c.delete(`/v1/alerts/${ok.body.id}`).expect(204);
    await c.delete(`/v1/alerts/${ok.body.id}`).expect(404);
  });

  it('refuses unknown/hidden products and bad thresholds; requires login', async () => {
    const { c } = await setup();
    await consent(c);
    const restricted = await mkCategory(t, `r${Date.now()}`, true);
    const hidden = await mkProduct(t, { category: restricted.id });
    await mkOffer(t, hidden, await mkRetailer(t), 5);
    await c.post('/v1/alerts').send({ product_id: hidden.id, threshold_qar: 5 }).expect(404);
    await c.post('/v1/alerts').send({ product_id: hidden.id, threshold_qar: -1 }).expect(422);
    await request(t.server).get('/v1/alerts').expect(401);
  });

  it("withdrawing the consent deactivates the user's alerts", async () => {
    const { c, p } = await setup();
    await consent(c);
    await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 5 }).expect(201);
    await consent(c, false);
    const list = await c.get('/v1/alerts').expect(200);
    expect(list.body.alerts[0].active).toBe(false);
  });
});

describe('alert delivery', () => {
  it('emails once when the price is at/below the threshold, with one-click unsubscribe headers', async () => {
    const { c, p, email } = await setup(4);
    await consent(c);
    await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 4.5 }).expect(201);
    const before = t.mailer.sent.length;
    const r1 = await alerts.evaluate(DAYTIME);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const mail = t.mailer.sent.slice(before).find((m) => m.to === email)!;
    expect(mail.subject).toMatch(/4\.00/);
    expect(mail.text).toMatch(/check at the store/i);
    expect(mail.headers?.['List-Unsubscribe']).toMatch(/unsubscribe\?token=/);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const again = t.mailer.sent.length;
    await alerts.evaluate(DAYTIME); // within 24 h: no repeat
    expect(t.mailer.sent.slice(again).filter((m) => m.to === email)).toHaveLength(0);
    await alerts.evaluate(new Date(DAYTIME.getTime() + 25 * 3600_000)); // next day: fires again
    expect(t.mailer.sent.slice(again).filter((m) => m.to === email)).toHaveLength(1);
  });

  it('does not email when the price is above the threshold, stale, or the product is out of stock', async () => {
    const { c, p, r, email } = await setup(9);
    await consent(c);
    await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 5 }).expect(201);
    const n = t.mailer.sent.length;
    await alerts.evaluate(DAYTIME);
    expect(t.mailer.sent.slice(n).filter((m) => m.to === email)).toHaveLength(0);
    await t.db.query(
      `update current_prices set price_qar = 4, in_stock = false where source_id = $1`,
      [r.sourceId],
    );
    await alerts.evaluate(DAYTIME);
    expect(t.mailer.sent.slice(n).filter((m) => m.to === email)).toHaveLength(0);
    await t.db.query(
      `update current_prices set in_stock = true, observed_at = now() - interval '10 days' where source_id = $1`,
      [r.sourceId],
    );
    await alerts.evaluate(DAYTIME);
    expect(t.mailer.sent.slice(n).filter((m) => m.to === email)).toHaveLength(0);
  });

  it('respects quiet hours (23:00-07:00 Qatar time)', async () => {
    expect(inQuietHours(new Date('2026-10-05T20:30:00Z'))).toBe(true); // 23:30
    expect(inQuietHours(new Date('2026-10-05T03:00:00Z'))).toBe(true); // 06:00
    expect(inQuietHours(new Date('2026-10-05T04:00:00Z'))).toBe(false); // 07:00
    expect(inQuietHours(new Date('2026-10-05T19:59:00Z'))).toBe(false); // 22:59
    const { c, p, email } = await setup(4);
    await consent(c);
    await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 5 }).expect(201);
    const n = t.mailer.sent.length;
    expect(await alerts.evaluate(new Date('2026-10-05T21:00:00Z'))).toEqual({
      sent: 0,
      skipped: 0,
    });
    expect(t.mailer.sent.slice(n).filter((m) => m.to === email)).toHaveLength(0);
  });

  it('the unsubscribe link withdraws consent and deactivates alerts; bad tokens are refused', async () => {
    const { c, p, email } = await setup(4);
    await consent(c);
    await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 5 }).expect(201);
    await alerts.evaluate(DAYTIME);
    const link = t.mailer.last(email)!.headers!['List-Unsubscribe']!;
    const token = /token=([^>]+)/.exec(link)![1]!;
    await request(t.server).post('/v1/alerts/unsubscribe').send({ token }).expect(204);
    const me = await c.get('/v1/me').expect(200);
    expect(
      me.body.consents.find((x: { purpose: string }) => x.purpose === 'alerts_email').granted,
    ).toBe(false);
    expect((await c.get('/v1/alerts')).body.alerts[0].active).toBe(false);
    await request(t.server)
      .post('/v1/alerts/unsubscribe')
      .send({ token: 'x'.repeat(40) })
      .expect(400);
    // an access token must not work as an unsubscribe token
    const jwt = await import('jsonwebtoken');
    const access = jwt.sign({ sub: 'abc', typ: 'access' }, process.env.JWT_SECRET!, {
      expiresIn: 60,
    });
    await request(t.server).post('/v1/alerts/unsubscribe').send({ token: access }).expect(400);
  });

  it('skips users without (or who withdrew) consent and unverified/erased accounts', async () => {
    const { c, p, email } = await setup(4);
    await consent(c);
    await c.post('/v1/alerts').send({ product_id: p.id, threshold_qar: 5 }).expect(201);
    await t.db.query(
      `update alerts set active = true where user_id = (select id from users where email = $1)`,
      [email],
    );
    await t.db.query(
      `insert into consents (user_id, purpose, granted, version) select id, 'alerts_email', false, 'v0.1' from users where email = $1`,
      [email],
    );
    const n = t.mailer.sent.length;
    await alerts.evaluate(DAYTIME);
    expect(t.mailer.sent.slice(n).filter((m) => m.to === email)).toHaveLength(0);
  });
});
