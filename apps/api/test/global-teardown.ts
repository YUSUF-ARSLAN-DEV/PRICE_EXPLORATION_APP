import { rm } from 'node:fs/promises';
import { Client } from 'pg';

export default async function globalTeardown() {
  const base = process.env.__QARIB_ADMIN_DB_URL;
  const name = process.env.__QARIB_TEST_DB;
  if (!base || !name) return;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
  if (process.env.RECEIPT_DIR) await rm(process.env.RECEIPT_DIR, { recursive: true, force: true });
}
