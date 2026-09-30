import { existsSync } from 'node:fs';
import { MaintenanceService } from './jobs/maintenance.service';
import { BlobStore } from './reports/blob-store';
import { TestApp, createTestApp, mkCategory, mkProduct, signUp, uniq } from '../test/app';

let t: TestApp;
let job: MaintenanceService;
beforeAll(async () => {
  t = await createTestApp();
  job = t.app.get(MaintenanceService);
});
afterAll(() => t.close());

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('retention enforcement (plan 0.9)', () => {
  it('deletes receipt images after 7 days (file first, then the path) and keeps fresh ones', async () => {
    const { email } = await signUp(t);
    const u = await t.db.one<{ id: string }>('select id from users where email = $1', [email]);
    const cat = await mkCategory(t);
    const p = await mkProduct(t, { category: cat.id });
    const blobs = t.app.get(BlobStore);
    const oldUri = await blobs.put('jpeg', JPEG);
    const newUri = await blobs.put('jpeg', JPEG);
    const r = await t.db.query<{ id: string }>(
      `insert into price_reports (user_id, product_id, reported_price_qar, receipt_blob_path, created_at)
       values ($1, $2, 5, $3, now() - interval '8 days'), ($1, $2, 5, $4, now() - interval '1 day') returning id`,
      [u!.id, p.id, oldUri, newUri],
    );
    expect(existsSync(oldUri.replace('file://', ''))).toBe(true);

    const report = await job.run();
    expect(report.receipts_deleted).toBeGreaterThanOrEqual(1);
    expect(existsSync(oldUri.replace('file://', ''))).toBe(false);
    expect(existsSync(newUri.replace('file://', ''))).toBe(true);
    const rows = await t.db.query<{
      id: string;
      receipt_blob_path: string | null;
      receipt_deleted_at: Date | null;
    }>(
      'select id, receipt_blob_path, receipt_deleted_at from price_reports where id = any($1::uuid[])',
      [r.map((x) => x.id)],
    );
    const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(byId[r[0]!.id]).toMatchObject({ receipt_blob_path: null });
    expect(byId[r[0]!.id]!.receipt_deleted_at).toBeTruthy();
    expect(byId[r[1]!.id]!.receipt_blob_path).toBe(newUri);
  });

  it('purges old idempotency keys, expired tokens, 90-day history and stale rare search terms', async () => {
    const { email } = await signUp(t);
    const u = await t.db.one<{ id: string }>('select id from users where email = $1', [email]);
    const rare = uniq('rare');
    const popular = uniq('pop');
    await t.db.query(
      `insert into idempotency_keys (key, scope, method, path, status, created_at) values ('old-key-123456', 'anon:x', 'POST', '/x', 201, now() - interval '3 days'), ('new-key-123456', 'anon:x', 'POST', '/x', 201, now())`,
    );
    await t.db.query(
      `insert into email_tokens (user_id, purpose, token_hash, expires_at) values ($1, 'verify_email', $2, now() - interval '8 days'), ($1, 'verify_email', $3, now() + interval '1 day')`,
      [u!.id, uniq('h'), uniq('h')],
    );
    await t.db.query(
      `insert into search_history (user_id, query, created_at) values ($1, 'old', now() - interval '91 days'), ($1, 'recent', now() - interval '3 days')`,
      [u!.id],
    );
    await t.db.query(
      `insert into search_log (day, query_norm, hits) values (current_date - 40, $1, 2), (current_date - 40, $2, 30), (current_date - 500, $2, 99)`,
      [rare, popular],
    );

    const report = await job.run();
    expect(report.idempotency_deleted).toBeGreaterThanOrEqual(1);
    expect(report.email_tokens_deleted).toBeGreaterThanOrEqual(1);
    expect(
      await t.db.one(`select 1 from idempotency_keys where key = 'old-key-123456'`),
    ).toBeUndefined();
    expect(
      await t.db.one(`select 1 from idempotency_keys where key = 'new-key-123456'`),
    ).toBeDefined();
    const hist = await t.db.query<{ query: string }>(
      'select query from search_history where user_id = $1',
      [u!.id],
    );
    expect(hist.map((h) => h.query)).toEqual(['recent']);
    expect(
      await t.db.one('select 1 from search_log where query_norm = $1', [rare]),
    ).toBeUndefined(); // rare + > 30 days
    const pop = await t.db.query<{ day: string }>(
      'select day::text from search_log where query_norm = $1',
      [popular],
    );
    expect(pop).toHaveLength(1); // k >= 20 kept; the 500-day-old row is past 13 months
  });

  it('removes erased-user tombstones and their consent proof after one year', async () => {
    const { email } = await signUp(t);
    const u = await t.db.one<{ id: string }>('select id from users where email = $1', [email]);
    await t.db.query('select erase_user($1)', [u!.id]);
    expect(await t.db.one('select 1 from users where id = $1', [u!.id])).toBeDefined(); // tombstone
    await t.db.query(`update users set deleted_at = now() - interval '13 months' where id = $1`, [
      u!.id,
    ]);
    const report = await job.run();
    expect(report.personal_data_purge.user_tombstones).toBeGreaterThanOrEqual(1);
    expect(await t.db.one('select 1 from users where id = $1', [u!.id])).toBeUndefined();
    expect(await t.db.one('select 1 from consents where user_id = $1', [u!.id])).toBeUndefined();
  });

  it('is idempotent: a second run right after finds nothing to do', async () => {
    await job.run();
    const again = await job.run();
    expect(again.receipts_deleted + again.idempotency_deleted + again.email_tokens_deleted).toBe(0);
  });
});
