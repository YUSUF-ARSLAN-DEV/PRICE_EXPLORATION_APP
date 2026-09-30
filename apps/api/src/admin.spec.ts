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

const ADMIN_GETS = [
  '/v1/admin/health',
  '/v1/admin/sources',
  '/v1/admin/source-changes',
  '/v1/admin/held-prices',
  '/v1/admin/staged-offers',
  '/v1/admin/dead-letters',
  '/v1/admin/matches',
  '/v1/admin/reports',
  '/v1/admin/takedowns',
  '/v1/admin/claims',
];

describe('access control', () => {
  it.each(ADMIN_GETS)('%s: 401 anonymous, 403 for normal users, 200 for admins', async (path) => {
    await request(t.server).get(path).expect(401);
    const user = await signUp(t);
    await user.c.get(path).expect(403);
    const admin = await signUp(t, { admin: true });
    await admin.c.get(path).expect(200);
  });

  it('mutations are also admin-only', async () => {
    const user = await signUp(t);
    const r = await mkRetailer(t);
    await user.c
      .post(`/v1/admin/sources/${r.sourceId}/kill-switch`)
      .send({ reason: 'because' })
      .expect(403);
    await user.c
      .post('/v1/admin/products/merge')
      .send({ keep: r.id, drop: r.sourceId })
      .expect(403);
  });
});

describe('kill switch (policy P6)', () => {
  it('hides a retailer everywhere immediately, is audited with the admin as actor, and can be released', async () => {
    const admin = await signUp(t, { admin: true });
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id, name: uniq('ks') });
    const r = await mkRetailer(t);
    await mkOffer(t, p, r, 5);
    const visible = async () => (await request(t.server).get(`/v1/products/${p.id}`)).status;
    expect(await visible()).toBe(200);

    await admin.c
      .post(`/v1/admin/sources/${r.sourceId}/kill-switch`)
      .send({ reason: 'retailer asked us to stop' })
      .expect(200);
    expect(await visible()).toBe(404);
    const src = await t.db.one<{ kill_switch: boolean; kill_switch_reason: string }>(
      'select kill_switch, kill_switch_reason from sources where id = $1',
      [r.sourceId],
    );
    expect(src!.kill_switch).toBe(true);
    expect(src!.kill_switch_reason).toContain('retailer asked us to stop');
    const audit = await t.db.one<{ actor: string }>(
      `select actor from audit_log where entity_id = $1 and action = 'source.updated' order by ts desc limit 1`,
      [r.sourceId],
    );
    expect(audit!.actor).toBe(admin.email);

    await admin.c
      .post(`/v1/admin/sources/${r.sourceId}/kill-switch/release`)
      .send({ reason: 'resolved with retailer' })
      .expect(200);
    expect(await visible()).toBe(200);
    await admin.c
      .post(`/v1/admin/sources/${r.sourceId}/kill-switch`)
      .send({ reason: 'x' })
      .expect(422);
    await admin.c
      .post(`/v1/admin/sources/00000000-0000-4000-8000-000000000000/kill-switch`)
      .send({ reason: 'unknown source' })
      .expect(409);
  });
});

describe('four-eyes legal status changes (plan 8.2)', () => {
  it('a second admin must approve; the requester cannot approve their own change', async () => {
    const [alice, bob] = [await signUp(t, { admin: true }), await signUp(t, { admin: true })];
    const r = await mkRetailer(t, { status: 'red', method: 'public_web' });
    const change = {
      legal_status: 'green',
      approval_ref: 'counsel-memo-2026-10',
      tos_archive_url: 'blob://tos',
      robots_archive_url: 'blob://robots',
    };
    const req = await alice.c
      .post(`/v1/admin/sources/${r.sourceId}/changes`)
      .send({ reason: 'Counsel approved scraping', change })
      .expect(201);
    const status = () =>
      t.db.one<{ legal_status: string }>('select legal_status from sources where id = $1', [
        r.sourceId,
      ]);
    expect((await status())!.legal_status).toBe('red'); // nothing changes until approved

    const self = await alice.c.post(`/v1/admin/source-changes/${req.body.id}/approve`).expect(403);
    expect(self.body.code).toBe('four_eyes');
    expect((await status())!.legal_status).toBe('red');

    await bob.c.post(`/v1/admin/source-changes/${req.body.id}/approve`).expect(200);
    expect((await status())!.legal_status).toBe('green');
    const audit = await t.db.one<{ actor: string }>(
      `select actor from audit_log where entity_id = $1 and action = 'source.updated' order by ts desc limit 1`,
      [r.sourceId],
    );
    expect(audit!.actor).toBe(bob.email);
    await bob.c.post(`/v1/admin/source-changes/${req.body.id}/approve`).expect(409); // already decided
  });

  it('rejecting leaves the source untouched; unknown fields and empty changes are refused', async () => {
    const [alice, bob] = [await signUp(t, { admin: true }), await signUp(t, { admin: true })];
    const r = await mkRetailer(t, { status: 'red', method: 'manual' });
    const req = await alice.c
      .post(`/v1/admin/sources/${r.sourceId}/changes`)
      .send({ reason: 'trying amber', change: { legal_status: 'amber' } })
      .expect(201);
    await bob.c.post(`/v1/admin/source-changes/${req.body.id}/reject`).expect(200);
    expect(
      (await t.db.one<{ legal_status: string }>('select legal_status from sources where id = $1', [
        r.sourceId,
      ]))!.legal_status,
    ).toBe('red');
    await alice.c
      .post(`/v1/admin/sources/${r.sourceId}/changes`)
      .send({ reason: 'sneaky', change: { kill_switch: false } })
      .expect(422);
    await alice.c
      .post(`/v1/admin/sources/${r.sourceId}/changes`)
      .send({ reason: 'empty one', change: {} })
      .expect(422);
  });

  it('the database itself refuses a green public_web source without approval evidence', async () => {
    const admin = await signUp(t, { admin: true });
    const r = await mkRetailer(t, { status: 'red', method: 'public_web' });
    const bob = await signUp(t, { admin: true });
    const req = await admin.c
      .post(`/v1/admin/sources/${r.sourceId}/changes`)
      .send({ reason: 'no evidence given', change: { legal_status: 'green' } })
      .expect(201);
    await bob.c.post(`/v1/admin/source-changes/${req.body.id}/approve`).expect(400); // check_violation
  });
});

describe('review queues', () => {
  it('held prices: approve publishes, reject closes', async () => {
    const admin = await signUp(t, { admin: true });
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id });
    const r = await mkRetailer(t);
    const rp = await mkOffer(t, p, r, 10);
    const batch = await t.db.one<{ id: string }>(
      'insert into ingestion_batches (source_id) values ($1) returning id',
      [r.sourceId],
    );
    const hold = async (price: number) =>
      (await t.db.one<{ id: string }>(
        `insert into held_prices (batch_id, source_id, retailer_product_id, price_qar, observed_at, reason)
         values ($1, $2, $3, $4, now(), 'jump') returning id`,
        [batch!.id, r.sourceId, rp, price],
      ))!.id;
    const a = await hold(30);
    const b = await hold(99);
    const list = await admin.c.get('/v1/admin/held-prices').expect(200);
    expect(list.body.map((h: { id: string }) => h.id)).toEqual(expect.arrayContaining([a, b]));
    await admin.c.post(`/v1/admin/held-prices/${a}/approve`).expect(200);
    expect(
      (await t.db.one<{ price_qar: string }>(
        'select price_qar from current_prices where retailer_product_id = $1',
        [rp],
      ))!.price_qar,
    ).toBe('30.00');
    await admin.c.post(`/v1/admin/held-prices/${b}/reject`).expect(200);
    await admin.c.post(`/v1/admin/held-prices/${b}/reject`).expect(404);
    await admin.c.post(`/v1/admin/held-prices/${a}/approve`).expect(409);
  });

  it('match queue: decide links the listing; merge keeps one product', async () => {
    const admin = await signUp(t, { admin: true });
    const cat = await mkCategory(t);
    const keep = await mkProduct(t, { category: cat.id });
    const drop = await mkProduct(t, { category: cat.id });
    const r = await mkRetailer(t);
    const listing = await t.db.one<{ id: string }>(
      `insert into retailer_products (retailer_id, source_id, external_sku, raw_name) values ($1, $2, $3, 'Mystery milk') returning id`,
      [r.id, r.sourceId, uniq('sku')],
    );
    await t.db.query(
      `insert into match_candidates (retailer_product_id, product_id, score, method) values ($1, $2, 0.88, 'fuzzy')`,
      [listing!.id, keep.id],
    );
    const q = await admin.c.get('/v1/admin/matches?limit=200').expect(200);
    const mine = q.body.find((m: { id: string }) => m.id === listing!.id);
    expect(mine.candidates[0].product_id).toBe(keep.id);
    await admin.c
      .post(`/v1/admin/matches/${listing!.id}/decide`)
      .send({ product_id: keep.id })
      .expect(200);
    expect(
      (await t.db.one<{ match_status: string }>(
        'select match_status from retailer_products where id = $1',
        [listing!.id],
      ))!.match_status,
    ).toBe('manual');
    await admin.c.post(`/v1/admin/matches/${listing!.id}/split`).expect(200);
    await admin.c.post(`/v1/admin/matches/${listing!.id}/reject`).expect(200);
    await admin.c
      .post('/v1/admin/products/merge')
      .send({ keep: keep.id, drop: drop.id })
      .expect(200);
    expect(await t.db.one('select 1 from products where id = $1', [drop.id])).toBeUndefined();
    await admin.c
      .post('/v1/admin/products/merge')
      .send({ keep: keep.id, drop: keep.id })
      .expect(409);
  });

  it('staged flyer offers: approve publishes through the gate', async () => {
    const admin = await signUp(t, { admin: true });
    const r = await mkRetailer(t, { method: 'flyer' });
    const so = await t.db.one<{ id: string }>(
      `insert into staged_offers (source_id, raw_name, price_qar, valid_to) values ($1, 'Flyer rice 5kg', 28, current_date + 6) returning id`,
      [r.sourceId],
    );
    await admin.c.post(`/v1/admin/staged-offers/${so!.id}/approve`).expect(200);
    expect(
      await t.db.one('select 1 from current_prices where source_id = $1', [r.sourceId]),
    ).toBeDefined();
    await admin.c.post(`/v1/admin/staged-offers/${so!.id}/reject`).expect(409);
  });
});

describe('takedowns and complaints (policy P6)', () => {
  it("anyone can file; an admin resolving with source_disabled kills the retailer's sources", async () => {
    const anon = request(t.server);
    const bad = await anon
      .post('/v1/takedown')
      .send({ requester_email: 'nope', summary: 'short' })
      .expect(422);
    expect(bad.body.errors.length).toBeGreaterThan(0);
    const filed = await anon
      .post('/v1/takedown')
      .send({
        requester_name: 'Retailer Legal',
        requester_email: 'legal@retailer.example',
        summary: 'Please stop using our prices',
      })
      .expect(202);
    expect(t.mailer.last('legal@example.qa')?.subject).toContain(filed.body.id);

    const admin = await signUp(t, { admin: true });
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id });
    const r = await mkRetailer(t);
    await mkOffer(t, p, r, 5);
    await t.db.query('update takedown_requests set retailer_id = $2 where id = $1', [
      filed.body.id,
      r.id,
    ]);

    const open = await admin.c.get('/v1/admin/takedowns').expect(200);
    expect(open.body.map((x: { id: string }) => x.id)).toContain(filed.body.id);
    await admin.c.post(`/v1/admin/takedowns/${filed.body.id}/acknowledge`).expect(200);
    await admin.c
      .post(`/v1/admin/takedowns/${filed.body.id}/resolve`)
      .send({ action: 'source_disabled', notes: 'complied' })
      .expect(200);
    await request(t.server).get(`/v1/products/${p.id}`).expect(404);
    const row = await t.db.one<{ resolved_at: Date; action: string }>(
      'select resolved_at, action from takedown_requests where id = $1',
      [filed.body.id],
    );
    expect(row).toMatchObject({ action: 'source_disabled' });
    expect(row!.resolved_at).toBeTruthy();
    await admin.c
      .post(`/v1/admin/takedowns/${filed.body.id}/resolve`)
      .send({ action: 'rejected' })
      .expect(404); // already closed
  });
});

describe('retailer claims (plan 11.3)', () => {
  const valid = {
    company_name: 'Example Mart WLL',
    website: 'https://retailer.example',
    contact_name: 'Sara Buyer',
    contact_email: 'sara@retailer.example',
    message: 'We can supply a daily price feed.',
  };

  it('anyone can file a claim; it is validated, stored, and the internal inbox is told (no mail to the claimant)', async () => {
    const anon = request(t.server);
    const bad = await anon
      .post('/v1/retailers/claims')
      .send({ ...valid, contact_email: 'nope', website: 'javascript:alert(1)' })
      .expect(422);
    expect(bad.body.errors.length).toBeGreaterThanOrEqual(2);
    const before = t.mailer.sent.length;
    const ok = await anon.post('/v1/retailers/claims').send(valid).expect(202);
    expect(t.mailer.last('legal@example.qa')?.subject).toContain(ok.body.id);
    expect(t.mailer.sent.length).toBe(before + 1);
    expect(t.mailer.last('sara@retailer.example')).toBeUndefined();
  });

  it('admins verify through a documented decision: a reason is required, it is audited, and it is final', async () => {
    const filed = await request(t.server).post('/v1/retailers/claims').send(valid).expect(202);
    const user = await signUp(t);
    await user.c
      .post(`/v1/admin/claims/${filed.body.id}/decide`)
      .send({ decision: 'verified', notes: 'sure ok' })
      .expect(403);

    const admin = await signUp(t, { admin: true });
    const open = await admin.c.get('/v1/admin/claims').expect(200);
    expect(open.body.map((x: { id: string }) => x.id)).toContain(filed.body.id);

    await admin.c
      .post(`/v1/admin/claims/${filed.body.id}/decide`)
      .send({ decision: 'verified' })
      .expect(409); // no reason
    await admin.c
      .post(`/v1/admin/claims/${filed.body.id}/decide`)
      .send({ decision: 'verifying', notes: 'call booked' })
      .expect(200);
    await admin.c
      .post(`/v1/admin/claims/${filed.body.id}/decide`)
      .send({ decision: 'verified', notes: 'called back on the number from their website' })
      .expect(200);
    await admin.c
      .post(`/v1/admin/claims/${filed.body.id}/decide`)
      .send({ decision: 'rejected', notes: 'too late now' })
      .expect(409);

    const row = await t.db.one<{ status: string; decided_by: string }>(
      'select status, decided_by from retailer_claims where id = $1',
      [filed.body.id],
    );
    expect(row?.status).toBe('verified');
    expect(row?.decided_by).toBeTruthy();
    const still = await admin.c.get('/v1/admin/claims').expect(200);
    expect(still.body.map((x: { id: string }) => x.id)).not.toContain(filed.body.id);
  });

  it('is rate limited per client like every other public form', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++)
      codes.push((await request(t.server).post('/v1/retailers/claims').send(valid)).status);
    // 5 per hour per client: this spec has already filed 3, so the 6th request overall is refused
    expect(codes).toContain(429);
    expect(codes.filter((c) => c === 202).length).toBeLessThanOrEqual(2);
  });
});
