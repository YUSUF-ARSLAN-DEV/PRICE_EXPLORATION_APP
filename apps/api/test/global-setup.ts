import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { migrateUp } from '@qarib/db';

/** One throw-away database for the whole API test-run (created here, dropped in teardown). */
export default async function globalSetup() {
  const base =
    process.env.DATABASE_URL ?? 'postgresql://qarib:qarib_local_only@localhost:5432/qarib';
  const admin = new Client({ connectionString: base, connectionTimeoutMillis: 3000 });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`API tests need Postgres (run \`pnpm up\`): ${(err as Error).message}`);
  }
  const name = `qarib_apitest_${randomBytes(4).toString('hex')}`;
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(base);
  u.pathname = `/${name}`;
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  await migrateUp(c);
  await c.end();

  process.env.DATABASE_URL = u.toString();
  process.env.__QARIB_ADMIN_DB_URL = base;
  process.env.__QARIB_TEST_DB = name;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
  process.env.RATE_LIMIT_PER_MIN ??= '100000';
  process.env.AUTH_RATE_LIMIT_PER_MIN ??= '100000';
  process.env.RECEIPT_DIR = `${process.env.TEMP ?? '/tmp'}/qarib-test-receipts-${name}`;
  delete process.env.MEILI_URL;
}
