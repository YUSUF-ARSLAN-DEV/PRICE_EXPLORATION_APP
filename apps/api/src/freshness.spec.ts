import { FreshnessService } from './jobs/freshness.service';
import { Logger } from '@nestjs/common';
import { TestApp, createTestApp, mkRetailer } from '../test/app';

let t: TestApp;
let svc: FreshnessService;
beforeAll(async () => {
  t = await createTestApp();
  svc = new FreshnessService(t.db);
});
afterAll(() => t.close());

describe('freshness watchdog (plan 1.4 SLO)', () => {
  it('flags approved sources that never delivered or are overdue, and stays quiet for fresh/disabled/red ones', async () => {
    const never = await mkRetailer(t); // partner_feed, green, never ran
    const fresh = await mkRetailer(t);
    const stale = await mkRetailer(t);
    const killed = await mkRetailer(t);
    const red = await mkRetailer(t, { status: 'red' });
    await t.db.query(`update sources set last_ok_at = now() - interval '2 hours' where id = $1`, [
      fresh.sourceId,
    ]);
    await t.db.query(`update sources set last_ok_at = now() - interval '60 hours' where id = $1`, [
      stale.sourceId,
    ]);
    await t.db.query(`select disable_source($1, 'takedown')`, [killed.sourceId]);

    const lines: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((m: unknown) => void lines.push(String(m)));
    const res = await svc.check();
    spy.mockRestore();

    const ids = res.breaches.map((b) => b.source_id);
    expect(ids).toContain(never.sourceId);
    expect(ids).toContain(stale.sourceId);
    expect(ids).not.toContain(fresh.sourceId);
    expect(ids).not.toContain(killed.sourceId);
    expect(ids).not.toContain(red.sourceId);
    expect(res.breaches.find((b) => b.source_id === never.sourceId)!.hours_since_ok).toBeNull();
    // one structured, alertable line per breach
    const line = lines.find((l) => l.includes(stale.sourceId))!;
    expect(JSON.parse(line)).toMatchObject({
      event: 'qarib.freshness.breach',
      retailer_slug: stale.slug,
      target_hours: 48,
    });
  });

  it('uses method-specific targets (a weekly flyer is fine after 5 days, a daily feed is not)', async () => {
    const flyer = await mkRetailer(t, { method: 'flyer' });
    const feed = await mkRetailer(t);
    await t.db.query(
      `update sources set last_ok_at = now() - interval '5 days' where id = any($1::uuid[])`,
      [[flyer.sourceId, feed.sourceId]],
    );
    const ids = (await svc.check()).breaches.map((b) => b.source_id);
    expect(ids).not.toContain(flyer.sourceId);
    expect(ids).toContain(feed.sourceId);
  });
});
