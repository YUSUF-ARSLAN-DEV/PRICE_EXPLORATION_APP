import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Client } from 'pg';
import { connect, databaseUrl } from './connection';
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from './migrate';
import { seed } from './seed';

/**
 * Integration tests against a real, throw-away Postgres database (created + dropped per run).
 * Skipped when no server is reachable, unless REQUIRE_DB=1 (CI), where it is a failure.
 */
let admin: Client | undefined;
let db: Client | undefined;
let dbName = '';
let skipReason: string | undefined;

function urlFor(name: string): string {
  const u = new URL(databaseUrl());
  u.pathname = `/${name}`;
  return u.toString();
}

before(async () => {
  try {
    admin = await connect(databaseUrl());
  } catch (err) {
    if (process.env.REQUIRE_DB === '1') throw err;
    skipReason = `no database reachable (${(err as Error).message}) - run \`pnpm up\``;
    return;
  }
  dbName = `qarib_test_${randomBytes(4).toString('hex')}`;
  await admin.query(`create database ${dbName}`);
  db = await connect(urlFor(dbName));
  await migrateUp(db);
});

after(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }
});

/** Test that auto-skips when there is no DB. */
function dbTest(name: string, fn: (c: Client) => Promise<void>) {
  test(name, async (t) => {
    if (skipReason || !db) return t.skip(skipReason);
    await fn(db);
  });
}

async function rejects(c: Client, sql: string, params: unknown[], re: RegExp) {
  await c.query('savepoint sp');
  try {
    await c.query(sql, params);
    assert.fail(`expected failure matching ${re}`);
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    assert.match((err as Error).message, re);
  } finally {
    await c.query('rollback to savepoint sp');
  }
}

/** Runs fn inside a transaction that is always rolled back (test isolation). */
async function tx(c: Client, fn: () => Promise<void>) {
  await c.query('begin');
  try {
    await fn();
  } finally {
    await c.query('rollback');
  }
}

async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []) {
  const r = await c.query(sql, params);
  return r.rows[0] as T;
}

// ---- fixtures -------------------------------------------------------------------------------
async function mkRetailer(c: Client, slug = 'r-' + randomBytes(3).toString('hex'), demo = false) {
  const r = await one<{ id: string }>(
    c,
    `insert into retailers (slug, name_en, type, is_demo) values ($1, $1, 'supermarket', $2) returning id`,
    [slug, demo],
  );
  return r.id;
}
async function mkSource(c: Client, retailerId: string, method = 'manual', status = 'green') {
  const r = await one<{ id: string }>(
    c,
    `insert into sources (retailer_id, method, legal_status) values ($1, $2, $3) returning id`,
    [retailerId, method, status],
  );
  return r.id;
}
async function mkCategory(
  c: Client,
  slug: string,
  restricted = false,
  parent: string | null = null,
) {
  const r = await one<{ id: string }>(
    c,
    `insert into categories (slug, name_en, name_ar, restricted, parent_id) values ($1, $1, $1, $2, $3) returning id`,
    [slug, restricted, parent],
  );
  return r.id;
}
async function mkProduct(
  c: Client,
  cat: string,
  size: [number, string, number] | null = [1, 'l', 1],
) {
  const r = await one<{ id: string }>(
    c,
    `insert into products (canonical_name_en, category_id, size_value, size_unit, pack_count)
     values ('P ' || gen_random_uuid(), $1, $2, $3, $4) returning id`,
    [cat, size?.[0] ?? null, size?.[1] ?? null, size?.[2] ?? 1],
  );
  return r.id;
}
async function mkListing(
  c: Client,
  retailerId: string,
  sourceId: string,
  productId: string | null,
  status = 'auto',
) {
  const r = await one<{ id: string }>(
    c,
    `insert into retailer_products (retailer_id, source_id, external_sku, raw_name, product_id, match_status)
     values ($1, $2, gen_random_uuid()::text, 'raw', $3, $4) returning id`,
    [retailerId, sourceId, productId, status],
  );
  return r.id;
}
const record = (c: Client, rp: string, price: number, src: string, observed = 'now()') =>
  c.query(`select record_price($1, null, $2, null, 'none', null, true, ${observed}, $3)`, [
    rp,
    price,
    src,
  ]);

// ---- migrations -----------------------------------------------------------------------------
describe('migrations', () => {
  dbTest('all migrations are applied and re-running is a no-op', async (c) => {
    const status = await migrationStatus(c);
    assert.ok(status.length >= 6);
    assert.ok(status.every((s) => s.applied));
    assert.deepEqual(await migrateUp(c), []);
  });

  dbTest('every migration has a working down: full roll-back then up again', async (c) => {
    const n = loadMigrations().length;
    const reverted = await migrateDown(c, n);
    assert.equal(reverted.length, n);
    const left = await one<{ n: string }>(
      c,
      `select count(*) n from information_schema.tables where table_schema = 'public' and table_name <> 'schema_migrations'`,
    );
    assert.equal(left.n, '0', 'tables left behind after rolling everything back');
    assert.equal((await migrateUp(c)).length, n);
  });

  dbTest('checksum mismatch on an applied migration is detected', async (c) => {
    await c.query(`update schema_migrations set checksum = 'tampered' where name like '0001%'`);
    await assert.rejects(() => migrateUp(c), /checksum mismatch/);
    const real = loadMigrations()[0]!;
    await c.query(`update schema_migrations set checksum = $1 where name = $2`, [
      real.checksum,
      real.name,
    ]);
  });
});

// ---- helpers --------------------------------------------------------------------------------
describe('helpers', () => {
  dbTest('uuid_generate_v7 yields version-7 UUIDs that sort by time', async (c) => {
    const a = await one<{ id: string }>(c, 'select uuid_generate_v7()::text id');
    await c.query('select pg_sleep(0.01)');
    const b = await one<{ id: string }>(c, 'select uuid_generate_v7()::text id');
    assert.equal(a.id[14], '7');
    assert.match(a.id[19]!, /[89ab]/);
    assert.ok(a.id < b.id);
  });
});

// ---- catalogue ------------------------------------------------------------------------------
describe('catalogue constraints', () => {
  dbTest(
    'P2: green automated source needs approval; public_web also needs ToS + robots archives',
    async (c) => {
      await tx(c, async () => {
        const r = await mkRetailer(c);
        await rejects(
          c,
          `insert into sources (retailer_id, method, legal_status) values ($1, 'partner_feed', 'green')`,
          [r],
          /sources_green_requires_approval/,
        );
        await rejects(
          c,
          `insert into sources (retailer_id, method, legal_status, approval_ref) values ($1, 'public_web', 'green', 'email-2026')`,
          [r],
          /sources_public_web_green_requires_archives/,
        );
        await c.query(
          `insert into sources (retailer_id, method, legal_status, approval_ref, tos_archive_url, robots_archive_url)
         values ($1, 'public_web', 'green', 'email-2026', 'blob://tos', 'blob://robots')`,
          [r],
        );
        await c.query(
          `insert into sources (retailer_id, method, legal_status) values ($1, 'crowd', 'green')`,
          [r],
        );
        await c.query(`insert into sources (retailer_id, method) values ($1, 'public_web')`, [r]); // default red
      });
    },
  );

  dbTest('gtin, size and pack constraints', async (c) => {
    await tx(c, async () => {
      const cat = await mkCategory(c, 'k1');
      const bad = `insert into products (canonical_name_en, category_id, gtin) values ('x', $1, $2)`;
      await rejects(c, bad, [cat, '12345'], /products_gtin_check/);
      await c.query(bad, [cat, '6281007000017'.slice(0, 13)]);
      await rejects(
        c,
        `insert into products (canonical_name_en, category_id, size_value) values ('x', $1, 5)`,
        [cat],
        /products_size_both_or_none/,
      );
      await rejects(
        c,
        `insert into products (canonical_name_en, category_id, size_value, size_unit) values ('x', $1, 0, 'g')`,
        [cat],
        /size_value_check/,
      );
      await rejects(
        c,
        `insert into products (canonical_name_en, category_id, pack_count) values ('x', $1, 0)`,
        [cat],
        /pack_count_check/,
      );
      await rejects(c, bad, [cat, '6281007000017'.slice(0, 13)], /products_gtin_uidx/);
    });
  });

  dbTest(
    'base_quantity / base_unit are derived (2 x 500 g = 1 kg, 6 x 330 ml = 1.98 L)',
    async (c) => {
      await tx(c, async () => {
        const cat = await mkCategory(c, 'k2');
        const a = await one<{ base_quantity: string; base_unit: string }>(
          c,
          `select base_quantity, base_unit from products where id = $1`,
          [await mkProduct(c, cat, [500, 'g', 2])],
        );
        assert.equal(Number(a.base_quantity), 1);
        assert.equal(a.base_unit, 'kg');
        const b = await one<{ base_quantity: string; base_unit: string }>(
          c,
          `select base_quantity, base_unit from products where id = $1`,
          [await mkProduct(c, cat, [330, 'ml', 6])],
        );
        assert.equal(Number(b.base_quantity), 1.98);
        assert.equal(b.base_unit, 'l');
        const n = await one<{ base_quantity: string | null }>(
          c,
          `select base_quantity from products where id = $1`,
          [await mkProduct(c, cat, null)],
        );
        assert.equal(n.base_quantity, null);
      });
    },
  );

  dbTest(
    'listing must be matched unless in review/rejected; source must belong to retailer',
    async (c) => {
      await tx(c, async () => {
        const r1 = await mkRetailer(c);
        const r2 = await mkRetailer(c);
        const s1 = await mkSource(c, r1);
        await rejects(
          c,
          `insert into retailer_products (retailer_id, source_id, external_sku, raw_name, match_status) values ($1, $2, 'a', 'n', 'auto')`,
          [r1, s1],
          /retailer_products_matched_has_product/,
        );
        await mkListing(c, r1, s1, null, 'review');
        await rejects(
          c,
          `insert into retailer_products (retailer_id, source_id, external_sku, raw_name) values ($1, $2, 'b', 'n')`,
          [r2, s1],
          /retailer_products_source_id_retailer_id_fkey/,
        );
      });
    },
  );

  dbTest('branches reject coordinates outside Qatar', async (c) => {
    await tx(c, async () => {
      const r = await mkRetailer(c);
      await rejects(
        c,
        `insert into branches (retailer_id, name, city, lat_approx, lng_approx) values ($1, 'x', 'Doha', 10, 51.5)`,
        [r],
        /lat_approx_check/,
      );
      await c.query(
        `insert into branches (retailer_id, name, city, lat_approx, lng_approx) values ($1, 'x', 'Doha', 25.285, 51.531)`,
        [r],
      );
    });
  });
});

// ---- restricted products (P8) ---------------------------------------------------------------
describe('restricted categories', () => {
  dbTest(
    'products in restricted categories (and their children) are forced restricted and never public',
    async (c) => {
      await tx(c, async () => {
        const top = await mkCategory(c, 'alc', true);
        const child = await mkCategory(c, 'alc-child', false, top);
        assert.equal(
          (
            await one<{ restricted: boolean }>(
              c,
              'select restricted from categories where id = $1',
              [child],
            )
          ).restricted,
          true,
        );

        const p = await mkProduct(c, child);
        assert.equal(
          (
            await one<{ restricted: boolean }>(c, 'select restricted from products where id = $1', [
              p,
            ])
          ).restricted,
          true,
        );
        // cannot be un-restricted while category is restricted
        await c.query('update products set restricted = false where id = $1', [p]);
        assert.equal(
          (
            await one<{ restricted: boolean }>(c, 'select restricted from products where id = $1', [
              p,
            ])
          ).restricted,
          true,
        );
        assert.equal(
          (await c.query('select 1 from public_products where id = $1', [p])).rowCount,
          0,
        );

        // offers for it are hidden too
        const r = await mkRetailer(c);
        const s = await mkSource(c, r);
        const rp = await mkListing(c, r, s, p);
        await record(c, rp, 5, s);
        assert.equal(
          (await c.query('select 1 from public_offers where product_id = $1', [p])).rowCount,
          0,
        );
      });
    },
  );

  dbTest('restricting a category later restricts existing products and children', async (c) => {
    await tx(c, async () => {
      const cat = await mkCategory(c, 'later');
      const kid = await mkCategory(c, 'later-kid', false, cat);
      const p = await mkProduct(c, kid);
      await c.query('update categories set restricted = true where id = $1', [cat]);
      assert.equal(
        (
          await one<{ restricted: boolean }>(c, 'select restricted from products where id = $1', [
            p,
          ])
        ).restricted,
        true,
      );
    });
  });
});

// ---- prices ---------------------------------------------------------------------------------
describe('prices', () => {
  dbTest(
    'monthly partitions exist for the current month and a default partition catches the rest',
    async (c) => {
      const now = new Date();
      const name = `prices_y${now.getUTCFullYear()}m${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      assert.ok((await one<{ r: string | null }>(c, `select to_regclass($1)::text r`, [name])).r);
      assert.ok(
        (await one<{ r: string | null }>(c, `select to_regclass('prices_default')::text r`)).r,
      );
      assert.equal(
        (await one<{ n: number }>(c, 'select ensure_price_partitions(1, 3) n')).n,
        0,
        'idempotent',
      );
      const made = (await one<{ n: number }>(c, 'select ensure_price_partitions(0, 8) n')).n;
      assert.ok(made >= 4);
    },
  );

  dbTest(
    'record_price writes history + current price, computes unit price, ignores older observations',
    async (c) => {
      await tx(c, async () => {
        const cat = await mkCategory(c, 'pp');
        const r = await mkRetailer(c);
        const s = await mkSource(c, r);
        const p = await mkProduct(c, cat, [500, 'g', 2]); // 1 kg
        const rp = await mkListing(c, r, s, p);

        await record(c, rp, 10, s, `now() - interval '2 days'`);
        let cur = await one<{ price_qar: string; unit_price_qar: string; unit_price_base: string }>(
          c,
          `select * from current_prices where retailer_product_id = $1`,
          [rp],
        );
        assert.equal(Number(cur.price_qar), 10);
        assert.equal(Number(cur.unit_price_qar), 10);
        assert.equal(cur.unit_price_base, 'kg');

        await record(c, rp, 12, s, `now() - interval '1 day'`);
        await record(c, rp, 99, s, `now() - interval '5 days'`); // late-arriving older data
        cur = await one(c, `select * from current_prices where retailer_product_id = $1`, [rp]);
        assert.equal(Number(cur.price_qar), 12, 'older observation must not overwrite newer');

        const hist = await one<{ n: string }>(
          c,
          `select count(*) n from prices where retailer_product_id = $1`,
          [rp],
        );
        assert.equal(hist.n, '3', 'history keeps every observation');
        assert.equal(
          (await c.query('select 1 from current_prices where retailer_product_id = $1', [rp]))
            .rowCount,
          1,
        );
      });
    },
  );

  dbTest('unit price is recomputed on re-match and on size change', async (c) => {
    await tx(c, async () => {
      const cat = await mkCategory(c, 'rm');
      const r = await mkRetailer(c);
      const s = await mkSource(c, r);
      const p1 = await mkProduct(c, cat, [1, 'l', 1]);
      const p2 = await mkProduct(c, cat, [2, 'l', 1]);
      const rp = await mkListing(c, r, s, null, 'review');
      await record(c, rp, 8, s);
      assert.equal(
        (
          await one<{ u: string | null }>(
            c,
            `select unit_price_qar u from current_prices where retailer_product_id = $1`,
            [rp],
          )
        ).u,
        null,
      );

      await c.query(
        `update retailer_products set product_id = $1, match_status = 'manual' where id = $2`,
        [p1, rp],
      );
      assert.equal(
        Number(
          (
            await one<{ u: string }>(
              c,
              `select unit_price_qar u from current_prices where retailer_product_id = $1`,
              [rp],
            )
          ).u,
        ),
        8,
      );

      await c.query(`update retailer_products set product_id = $1 where id = $2`, [p2, rp]);
      assert.equal(
        Number(
          (
            await one<{ u: string }>(
              c,
              `select unit_price_qar u from current_prices where retailer_product_id = $1`,
              [rp],
            )
          ).u,
        ),
        4,
      );

      await c.query(`update products set size_value = 4 where id = $1`, [p2]);
      assert.equal(
        Number(
          (
            await one<{ u: string }>(
              c,
              `select unit_price_qar u from current_prices where retailer_product_id = $1`,
              [rp],
            )
          ).u,
        ),
        2,
      );
    });
  });

  dbTest(
    'P2 defence in depth: record_price refuses red/amber/disabled sources and kill-switched ones',
    async (c) => {
      await tx(c, async () => {
        const cat = await mkCategory(c, 'p2');
        const r = await mkRetailer(c);
        const p = await mkProduct(c, cat);
        for (const status of ['red', 'amber', 'disabled']) {
          const s = await mkSource(c, r, 'manual', status);
          const rp = await mkListing(c, r, s, p);
          await rejects(
            c,
            `select record_price($1, null, 5, null, 'none', null, true, now(), $2)`,
            [rp, s],
            /not approved/,
          );
        }
        const ok = await mkSource(c, r);
        const rp = await mkListing(c, r, ok, p);
        await c.query('update sources set kill_switch = true where id = $1', [ok]);
        await rejects(
          c,
          `select record_price($1, null, 5, null, 'none', null, true, now(), $2)`,
          [rp, ok],
          /not approved/,
        );
        await c.query('update sources set kill_switch = false where id = $1', [ok]);
        await record(c, rp, 5, ok);
      });
    },
  );

  dbTest(
    'record_price validates listing/source pairing, future timestamps and was_price',
    async (c) => {
      await tx(c, async () => {
        const cat = await mkCategory(c, 'val');
        const r = await mkRetailer(c);
        const s1 = await mkSource(c, r);
        const s2 = await mkSource(c, r);
        const rp = await mkListing(c, r, s1, await mkProduct(c, cat));
        await rejects(
          c,
          `select record_price($1, null, 5, null, 'none', null, true, now(), $2)`,
          [rp, s2],
          /does not belong to source/,
        );
        await rejects(
          c,
          `select record_price($1, null, 5, null, 'none', null, true, now() + interval '3 days', $2)`,
          [rp, s1],
          /in the future/,
        );
        await rejects(
          c,
          `select record_price($1, null, 5, 4, 'none', null, true, now(), $2)`,
          [rp, s1],
          /prices_was_price_gt_price/,
        );
        await rejects(
          c,
          `select record_price($1, null, -1, null, 'none', null, true, now(), $2)`,
          [rp, s1],
          /price_qar/,
        );
      });
    },
  );

  dbTest('branch-specific prices are separate current prices', async (c) => {
    await tx(c, async () => {
      const cat = await mkCategory(c, 'br');
      const r = await mkRetailer(c);
      const s = await mkSource(c, r);
      const rp = await mkListing(c, r, s, await mkProduct(c, cat));
      const b = await one<{ id: string }>(
        c,
        `insert into branches (retailer_id, name, city) values ($1, 'B1', 'Doha') returning id`,
        [r],
      );
      await record(c, rp, 5, s);
      await c.query(`select record_price($1, $2, 6, null, 'none', null, true, now(), $3)`, [
        rp,
        b.id,
        s,
      ]);
      assert.equal(
        (await c.query('select 1 from current_prices where retailer_product_id = $1', [rp]))
          .rowCount,
        2,
      );
    });
  });
});

// ---- public views ---------------------------------------------------------------------------
describe('public_offers', () => {
  dbTest('shows only matched, approved, fresh, non-demo offers; flags stale ones', async (c) => {
    await tx(c, async () => {
      const cat = await mkCategory(c, 'po');
      const r = await mkRetailer(c);
      const s = await mkSource(c, r);
      const p = await mkProduct(c, cat);

      const fresh = await mkListing(c, r, s, p);
      await record(c, fresh, 5, s);

      const stale = await mkListing(c, r, s, await mkProduct(c, cat));
      await record(c, stale, 5, s, `now() - interval '10 days'`);

      const old = await mkListing(c, r, s, await mkProduct(c, cat));
      await record(c, old, 5, s, `now() - interval '40 days'`);

      const inReview = await mkListing(c, r, s, null, 'review');
      await record(c, inReview, 5, s);

      const rows = await c.query<{ is_stale: boolean; product_id: string }>(
        `select product_id, is_stale from public_offers where retailer_id = $1`,
        [r],
      );
      assert.equal(rows.rowCount, 2);
      assert.deepEqual(rows.rows.map((x) => x.is_stale).sort(), [false, true]);

      // revoking the source hides everything at once (takedown / kill switch)
      await c.query('update sources set kill_switch = true where id = $1', [s]);
      assert.equal(
        (await c.query('select 1 from public_offers where retailer_id = $1', [r])).rowCount,
        0,
      );
      await c.query('update sources set kill_switch = false, legal_status = $2 where id = $1', [
        s,
        'red',
      ]);
      assert.equal(
        (await c.query('select 1 from public_offers where retailer_id = $1', [r])).rowCount,
        0,
      );
    });
  });

  dbTest(
    'demo retailers are hidden unless qarib.show_demo = on; inactive retailers always hidden',
    async (c) => {
      await tx(c, async () => {
        const cat = await mkCategory(c, 'demo');
        const r = await mkRetailer(c, undefined, true);
        const s = await mkSource(c, r);
        const rp = await mkListing(c, r, s, await mkProduct(c, cat));
        await record(c, rp, 5, s);
        assert.equal(
          (await c.query('select 1 from public_offers where retailer_id = $1', [r])).rowCount,
          0,
        );
        await c.query(`select set_config('qarib.show_demo', 'on', true)`);
        assert.equal(
          (await c.query('select 1 from public_offers where retailer_id = $1', [r])).rowCount,
          1,
        );
        await c.query('update retailers set active = false where id = $1', [r]);
        assert.equal(
          (await c.query('select 1 from public_offers where retailer_id = $1', [r])).rowCount,
          0,
        );
      });
    },
  );
});

// ---- audit / ops ----------------------------------------------------------------------------
describe('audit', () => {
  dbTest(
    'source legal-status changes are audited with the actor; audit_log is append-only',
    async (c) => {
      await tx(c, async () => {
        await c.query(`select set_config('qarib.actor', 'counsel@example.qa', true)`);
        const r = await mkRetailer(c);
        const s = await mkSource(c, r, 'manual', 'red');
        await c.query(`update sources set legal_status = 'green' where id = $1`, [s]);
        await c.query(`update sources set notes = 'irrelevant change' where id = $1`, [s]);
        const rows = await c.query<{
          action: string;
          actor: string;
          before: { legal_status: string } | null;
          after: { legal_status: string };
        }>(
          `select action, actor, before, after from audit_log where entity_id = $1 order by ts, id`,
          [s],
        );
        assert.equal(
          rows.rowCount,
          2,
          'created + one status change; notes-only edit is not audited',
        );
        assert.equal(rows.rows[1]!.actor, 'counsel@example.qa');
        assert.equal(rows.rows[1]!.before!.legal_status, 'red');
        assert.equal(rows.rows[1]!.after.legal_status, 'green');

        await rejects(c, `update audit_log set actor = 'x'`, [], /append-only/);
        await rejects(c, `delete from audit_log`, [], /append-only/);
      });
    },
  );
});

// ---- privacy --------------------------------------------------------------------------------
describe('privacy', () => {
  dbTest(
    'every personal-data column carries a "[PII: <purpose>]" comment (plan 8.3)',
    async (c) => {
      const expected: [string, string][] = [
        ['users', 'email'],
        ['users', 'pw_hash'],
        ['users', 'locale'],
        ['consents', 'user_id'],
        ['consents', 'ip_trunc'],
        ['baskets', 'name'],
        ['alerts', 'threshold_qar'],
        ['search_history', 'query'],
        ['price_reports', 'user_id'],
        ['price_reports', 'receipt_blob_path'],
        ['takedown_requests', 'requester_name'],
        ['takedown_requests', 'requester_email'],
      ];
      for (const [table, col] of expected) {
        const r = await one<{ d: string | null }>(
          c,
          `select col_description(format('public.%I', $1::text)::regclass, a.attnum) d
         from pg_attribute a where a.attrelid = format('public.%I', $1::text)::regclass and a.attname = $2`,
          [table, col],
        );
        assert.match(r.d ?? '', /^\[PII: .+\]/, `${table}.${col} lacks a PII purpose comment`);
      }
    },
  );

  dbTest('consents ledger cannot be edited, only appended to', async (c) => {
    await tx(c, async () => {
      const u = await one<{ id: string }>(
        c,
        `insert into users (email, pw_hash) values ('a@example.com', 'h') returning id`,
      );
      await c.query(
        `insert into consents (user_id, purpose, granted, version) values ($1, 'analytics', true, 'v0.1')`,
        [u.id],
      );
      await c.query(
        `insert into consents (user_id, purpose, granted, version) values ($1, 'analytics', false, 'v0.1')`,
        [u.id],
      );
      await rejects(c, `update consents set granted = true`, [], /append-only/);
      await rejects(
        c,
        `insert into consents (user_id, purpose, granted, version) values ($1, 'marketing', true, 'v0.1')`,
        [u.id],
        /consents_purpose_check/,
      );
    });
  });

  dbTest('email is case-insensitively unique', async (c) => {
    await tx(c, async () => {
      await c.query(`insert into users (email, pw_hash) values ('Foo@Example.com', 'h')`);
      await rejects(
        c,
        `insert into users (email, pw_hash) values ('foo@example.com', 'h')`,
        [],
        /users_email_key/,
      );
    });
  });

  dbTest(
    'erase_user anonymises, deletes personal content, keeps consent proof and contributed prices',
    async (c) => {
      await tx(c, async () => {
        const cat = await mkCategory(c, 'er');
        const p = await mkProduct(c, cat);
        const u = await one<{ id: string }>(
          c,
          `insert into users (email, pw_hash) values ('gone@example.com', 'secret') returning id`,
        );
        const b = await one<{ id: string }>(
          c,
          `insert into baskets (user_id) values ($1) returning id`,
          [u.id],
        );
        await c.query(`insert into basket_items (basket_id, product_id) values ($1, $2)`, [
          b.id,
          p,
        ]);
        await c.query(
          `insert into alerts (user_id, product_id, threshold_qar) values ($1, $2, 5)`,
          [u.id, p],
        );
        await c.query(`insert into search_history (user_id, query) values ($1, 'milk')`, [u.id]);
        await c.query(
          `insert into consents (user_id, purpose, granted, version) values ($1, 'history', true, 'v0.1')`,
          [u.id],
        );
        const rep = await one<{ id: string }>(
          c,
          `insert into price_reports (user_id, reported_price_qar) values ($1, 4.5) returning id`,
          [u.id],
        );

        await c.query('select erase_user($1)', [u.id]);

        const user = await one<{ email: string; pw_hash: string; deleted_at: string | null }>(
          c,
          'select email, pw_hash, deleted_at from users where id = $1',
          [u.id],
        );
        assert.match(user.email, /^erased-.+@invalid\.invalid$/);
        assert.equal(user.pw_hash, '');
        assert.ok(user.deleted_at);
        for (const t of ['baskets', 'alerts', 'search_history']) {
          assert.equal(
            (await c.query(`select 1 from ${t} where user_id = $1`, [u.id])).rowCount,
            0,
            t,
          );
        }
        assert.equal(
          (await c.query('select 1 from basket_items where basket_id = $1', [b.id])).rowCount,
          0,
        );
        assert.equal(
          (await c.query('select 1 from consents where user_id = $1', [u.id])).rowCount,
          1,
          'consent proof retained',
        );
        const r = await one<{ user_id: string | null; reported_price_qar: string }>(
          c,
          'select user_id, reported_price_qar from price_reports where id = $1',
          [rep.id],
        );
        assert.equal(r.user_id, null);
        assert.equal(Number(r.reported_price_qar), 4.5);
        await rejects(
          c,
          `select erase_user('00000000-0000-0000-0000-000000000000')`,
          [],
          /unknown user/,
        );
      });
    },
  );

  dbTest('purge_expired_personal_data enforces the retention schedule', async (c) => {
    await tx(c, async () => {
      const u = await one<{ id: string }>(
        c,
        `insert into users (email, pw_hash) values ('keep@example.com', 'h') returning id`,
      );
      await c.query(
        `insert into search_history (user_id, query, created_at) values ($1, 'old', now() - interval '91 days'), ($1, 'new', now() - interval '10 days')`,
        [u.id],
      );
      const old = await one<{ id: string }>(
        c,
        `insert into users (email, pw_hash) values ('old@example.com', 'h') returning id`,
      );
      await c.query(
        `insert into consents (user_id, purpose, granted, version) values ($1, 'history', true, 'v0.1')`,
        [old.id],
      );
      await c.query('select erase_user($1)', [old.id]);
      await c.query(`update users set deleted_at = now() - interval '13 months' where id = $1`, [
        old.id,
      ]);

      const res = await c.query<{ entity: string; rows_affected: string }>(
        'select * from purge_expired_personal_data()',
      );
      const m = Object.fromEntries(res.rows.map((r) => [r.entity, Number(r.rows_affected)]));
      assert.equal(m.search_history, 1);
      assert.equal(m.consents_of_erased_users, 1);
      assert.equal(m.user_tombstones, 1);
      assert.equal(
        (await c.query('select 1 from search_history where user_id = $1', [u.id])).rowCount,
        1,
      );
      assert.equal((await c.query('select 1 from users where id = $1', [u.id])).rowCount, 1);
      assert.equal((await c.query('select 1 from users where id = $1', [old.id])).rowCount, 0);
    });
  });

  dbTest('receipts_due_for_deletion lists receipts older than 7 days only', async (c) => {
    await tx(c, async () => {
      await c.query(
        `insert into price_reports (reported_price_qar, receipt_blob_path, created_at) values (1, 'a.jpg', now() - interval '8 days'), (1, 'b.jpg', now() - interval '1 day'), (1, 'c.jpg', now() - interval '9 days')`,
      );
      await c.query(
        `update price_reports set receipt_deleted_at = now() where receipt_blob_path = 'c.jpg'`,
      );
      const r = await c.query<{ receipt_blob_path: string }>(
        'select receipt_blob_path from receipts_due_for_deletion',
      );
      assert.deepEqual(
        r.rows.map((x) => x.receipt_blob_path),
        ['a.jpg'],
      );
    });
  });
});

// ---- seed -----------------------------------------------------------------------------------
describe('seed', () => {
  dbTest(
    'seeds categories + 2 demo retailers idempotently, hidden from public views by default',
    async (c) => {
      await seed(c);
      const snapshot = async () =>
        await one<Record<string, string>>(
          c,
          `select (select count(*) from categories) cats,
                  (select count(*) from retailers where is_demo) demo,
                  (select count(*) from products) prods,
                  (select count(*) from retailer_products) listings,
                  (select count(*) from prices) prices`,
        );
      const first = await snapshot();
      await seed(c);
      assert.deepEqual(await snapshot(), first, 'second run must change nothing');

      assert.equal(first.demo, '2');
      assert.ok(Number(first.cats) >= 35);
      assert.equal(first.prods, '5');
      assert.equal(first.listings, '10');

      const depth = await one<{ d: number }>(
        c,
        `with recursive t as (select id, 1 d from categories where parent_id is null
         union all select c.id, t.d + 1 from categories c join t on c.parent_id = t.id)
       select max(d) d from t`,
      );
      assert.equal(depth.d, 3, 'category tree is 3 levels deep');

      const restricted = await one<{ n: string }>(
        c,
        `select count(*) n from categories where restricted`,
      );
      assert.equal(restricted.n, '2', 'alcohol/tobacco + pork');
      assert.equal(
        (await c.query('select 1 from public_offers')).rowCount,
        0,
        'demo hidden by default',
      );

      await c.query('begin');
      await c.query(`select set_config('qarib.show_demo', 'on', true)`);
      const shown = await c.query<{ unit_price_qar: string }>(
        `select unit_price_qar from public_offers where canonical_name_en = 'DemoFarm Fresh Milk Full Fat' order by unit_price_qar`,
      );
      await c.query('rollback');
      assert.equal(shown.rowCount, 4, '2 sizes x 2 retailers');
      assert.equal(
        Number(shown.rows[0]!.unit_price_qar),
        5.9,
        '2 x 500ml @ 5.90 => 5.90 per litre',
      );
    },
  );
});

// ---- least-privilege roles (plan 8.2) -----------------------------------------------------------
describe('database roles', () => {
  /** Runs `sql` as `role` inside a rolled-back transaction; resolves to the error code or 'ok'. */
  async function as(c: Client, role: string, sql: string, params: unknown[] = []): Promise<string> {
    await c.query('begin');
    try {
      await c.query(`set local role ${role}`);
      await c.query(sql, params);
      return 'ok';
    } catch (err) {
      return (err as { code?: string }).code ?? 'error';
    } finally {
      await c.query('rollback');
    }
  }
  const DENIED = '42501';

  dbTest('readonly sees only the public views', async (c) => {
    assert.equal(await as(c, 'qarib_readonly', 'select 1 from public_offers limit 1'), 'ok');
    assert.equal(await as(c, 'qarib_readonly', 'select 1 from public_products limit 1'), 'ok');
    assert.equal(await as(c, 'qarib_readonly', 'select 1 from public_price_history limit 1'), 'ok');
    for (const table of [
      'products',
      'retailer_products',
      'prices',
      'sources',
      'users',
      'consents',
      'audit_log',
      'categories',
    ]) {
      assert.equal(await as(c, 'qarib_readonly', `select 1 from ${table} limit 1`), DENIED, table);
    }
    assert.equal(
      await as(c, 'qarib_readonly', `insert into brands (name_en) values ('x')`),
      DENIED,
    );
  });

  dbTest('worker can ingest and match but can never read or write personal data', async (c) => {
    const personal = [
      'users',
      'consents',
      'baskets',
      'basket_items',
      'alerts',
      'search_history',
      'price_reports',
      'email_tokens',
      'refresh_tokens',
      'idempotency_keys',
      'takedown_requests',
    ];
    for (const table of personal) {
      assert.equal(
        await as(c, 'qarib_worker', `select 1 from ${table} limit 1`),
        DENIED,
        `${table} select`,
      );
      assert.equal(await as(c, 'qarib_worker', `delete from ${table}`), DENIED, `${table} delete`);
    }
    assert.equal(await as(c, 'qarib_worker', 'select 1 from schema_migrations'), DENIED);
    assert.equal(await as(c, 'qarib_worker', 'select 1 from retailer_products limit 1'), 'ok');
    assert.equal(
      await as(c, 'qarib_worker', `insert into brands (name_en) values ('worker-brand')`),
      'ok',
    );
    assert.equal(await as(c, 'qarib_worker', `update sources set notes = 'x' where false`), 'ok');
    assert.equal(
      await as(c, 'qarib_worker', 'delete from products'),
      DENIED,
      'workers cannot delete catalogue rows',
    );
    assert.equal(
      await as(c, 'qarib_worker', 'update prices set price_qar = 1'),
      DENIED,
      'prices are append-only',
    );
    assert.equal(await as(c, 'qarib_worker', 'create table evil (id int)'), DENIED, 'no DDL');
  });

  dbTest(
    'worker can run the real write path (record_price, disable_source) end to end',
    async (c) => {
      await tx(c, async () => {
        const r = await mkRetailer(c);
        const s = await mkSource(c, r);
        const cat = await mkCategory(c, 'role-cat');
        const p = await mkProduct(c, cat);
        const rp = await mkListing(c, r, s, p);
        await c.query('set local role qarib_worker');
        await c.query(`select record_price($1, null, 5, null, 'none', null, true, now(), $2)`, [
          rp,
          s,
        ]);
        await c.query(`select disable_source($1, 'test')`, [s]);
        await c.query('reset role');
        const row = await one<{ kill_switch: boolean }>(
          c,
          'select kill_switch from sources where id = $1',
          [s],
        );
        assert.equal(row.kill_switch, true);
      });
    },
  );

  dbTest(
    'api role: DML yes, DDL no, prices/audit_log append-only, migrations table hidden',
    async (c) => {
      assert.equal(
        await as(
          c,
          'qarib_api',
          `insert into users (email, pw_hash) values ('role-test@example.com', 'h')`,
        ),
        'ok',
      );
      assert.equal(await as(c, 'qarib_api', 'select 1 from users limit 1'), 'ok');
      assert.equal(await as(c, 'qarib_api', 'update prices set price_qar = 1'), DENIED);
      assert.equal(await as(c, 'qarib_api', 'delete from prices'), DENIED);
      assert.equal(await as(c, 'qarib_api', `update audit_log set actor = 'x'`), DENIED);
      assert.equal(await as(c, 'qarib_api', 'delete from audit_log'), DENIED);
      assert.equal(await as(c, 'qarib_api', 'select 1 from schema_migrations'), DENIED);
      assert.equal(await as(c, 'qarib_api', 'drop table products'), DENIED);
      assert.equal(await as(c, 'qarib_api', 'alter table users add column x int'), DENIED);
      assert.equal(await as(c, 'qarib_api', 'create role hacker'), DENIED);
    },
  );

  dbTest('grants cover partitions created later', async (c) => {
    await c.query(`select ensure_price_partitions(0, 14)`);
    await c.query('select refresh_role_grants()');
    const rows = await c.query<{ relname: string; api_update: boolean; worker_insert: boolean }>(
      `select c.relname,
              has_table_privilege('qarib_api', c.oid, 'update') as api_update,
              has_table_privilege('qarib_worker', c.oid, 'insert') as worker_insert
         from pg_class c where c.relname like 'prices\\_%' and c.relkind = 'r'`,
    );
    assert.ok(rows.rows.length >= 10);
    for (const r of rows.rows) {
      assert.equal(r.api_update, false, `${r.relname}: api must not update price history`);
      assert.equal(r.worker_insert, true, `${r.relname}: worker must be able to insert`);
    }
  });
});

// ---- privacy: erasure completeness + schema-drift guard (plan 8.3) ----------------------------------
describe('personal-data drift guard', () => {
  // Every table that references a user. Adding a table here means: include it in GET /me/export,
  // erase_user(), docs/legal/ropa.md and the retention schedule - THEN update this list.
  const USER_TABLES = [
    'alerts',
    'baskets',
    'consents',
    'email_tokens',
    'price_reports',
    'refresh_tokens',
    'search_history',
  ];
  const ERASED_COMPLETELY = [
    'alerts',
    'baskets',
    'email_tokens',
    'refresh_tokens',
    'search_history',
  ];

  dbTest(
    'no new table may reference users without being reviewed for export/erasure',
    async (c) => {
      const rows = await c.query<{ table_name: string }>(
        `select distinct table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'user_id' order by 1`,
      );
      assert.deepEqual(
        rows.rows.map((r) => r.table_name),
        USER_TABLES,
      );
      const scoped = await c.query(
        `select 1 from information_schema.columns where table_name = 'idempotency_keys' and column_name = 'scope'`,
      );
      assert.equal(
        scoped.rowCount,
        1,
        'idempotency_keys.scope holds user ids and is cleaned by erase_user()',
      );
    },
  );

  dbTest(
    'erase_user removes every identifying row, keeps only consent proof + anonymised tombstone',
    async (c) => {
      await tx(c, async () => {
        const cat = await mkCategory(c, 'erase-cat');
        const p = await mkProduct(c, cat);
        const u = await one<{ id: string }>(
          c,
          `insert into users (email, pw_hash) values ('full@example.com', 'hash') returning id`,
        );
        const b = await one<{ id: string }>(
          c,
          'insert into baskets (user_id) values ($1) returning id',
          [u.id],
        );
        await c.query('insert into basket_items (basket_id, product_id) values ($1, $2)', [
          b.id,
          p,
        ]);
        await c.query(
          'insert into alerts (user_id, product_id, threshold_qar) values ($1, $2, 3)',
          [u.id, p],
        );
        await c.query(`insert into search_history (user_id, query) values ($1, 'q')`, [u.id]);
        await c.query(
          `insert into email_tokens (user_id, purpose, token_hash, expires_at) values ($1, 'verify_email', 'h1', now() + interval '1 day')`,
          [u.id],
        );
        await c.query(
          `insert into refresh_tokens (user_id, family, token_hash, expires_at) values ($1, gen_random_uuid(), 'h2', now() + interval '1 day')`,
          [u.id],
        );
        await c.query(
          `insert into idempotency_keys (key, scope, method, path, status) values ('k-12345678', $1, 'POST', '/x', 201)`,
          [u.id],
        );
        await c.query(
          `insert into consents (user_id, purpose, granted, version) values ($1, 'history', true, 'v')`,
          [u.id],
        );
        await c.query('insert into price_reports (user_id, reported_price_qar) values ($1, 2)', [
          u.id,
        ]);

        await c.query('select erase_user($1)', [u.id]);

        for (const t of ERASED_COMPLETELY) {
          assert.equal(
            (await c.query(`select 1 from ${t} where user_id = $1`, [u.id])).rowCount,
            0,
            t,
          );
        }
        assert.equal(
          (await c.query(`select 1 from idempotency_keys where scope = $1`, [u.id])).rowCount,
          0,
        );
        assert.equal(
          (await c.query('select 1 from consents where user_id = $1', [u.id])).rowCount,
          1,
          'consent proof kept',
        );
        assert.equal(
          (await c.query('select 1 from price_reports where user_id = $1', [u.id])).rowCount,
          0,
          'contribution detached from the user',
        );
      });
    },
  );
});
