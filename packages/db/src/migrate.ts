import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';

/**
 * Minimal SQL-first migration runner (ADR-007). Migration files live in ../migrations, are named
 * NNNN_description.sql and contain `-- Up Migration` and `-- Down Migration` sections.
 * Each migration runs in one transaction; applied files are checksummed so edits are detected.
 */
export const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const LOCK_KEY = 727274; // arbitrary constant for pg_advisory_lock

export interface Migration {
  name: string;
  up: string;
  down: string;
  checksum: string;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const raw = readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
      const upMarker = /^-- Up Migration\s*$/m;
      const downMarker = /^-- Down Migration\s*$/m;
      if (!upMarker.test(raw) || !downMarker.test(raw)) {
        throw new Error(`${file}: needs both "-- Up Migration" and "-- Down Migration" sections`);
      }
      const [beforeDown, down = ''] = raw.split(downMarker);
      const up = beforeDown!.replace(upMarker, '');
      return {
        name: file.replace(/\.sql$/, ''),
        up,
        down,
        checksum: createHash('sha256').update(raw).digest('hex'),
      };
    });
}

async function ensureTable(client: Client) {
  await client.query(`create table if not exists schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
}

async function withLock<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

async function applied(client: Client): Promise<Map<string, string>> {
  const res = await client.query<{ name: string; checksum: string }>(
    'select name, checksum from schema_migrations order by name',
  );
  return new Map(res.rows.map((r) => [r.name, r.checksum]));
}

/** Apply all pending migrations. Returns the names applied. */
export async function migrateUp(client: Client, dir = MIGRATIONS_DIR): Promise<string[]> {
  return withLock(client, async () => {
    await ensureTable(client);
    const done = await applied(client);
    const all = loadMigrations(dir);
    for (const m of all) {
      const sum = done.get(m.name);
      if (sum !== undefined && sum !== m.checksum) {
        throw new Error(`Migration ${m.name} was modified after being applied (checksum mismatch)`);
      }
    }
    const ran: string[] = [];
    for (const m of all.filter((x) => !done.has(x.name))) {
      try {
        await client.query('begin');
        await client.query(m.up);
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [
          m.name,
          m.checksum,
        ]);
        await client.query('commit');
        ran.push(m.name);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
      }
    }
    return ran;
  });
}

/** Roll back the last `steps` applied migrations (newest first). */
export async function migrateDown(
  client: Client,
  steps = 1,
  dir = MIGRATIONS_DIR,
): Promise<string[]> {
  return withLock(client, async () => {
    await ensureTable(client);
    const done = await applied(client);
    const byName = new Map(loadMigrations(dir).map((m) => [m.name, m]));
    const toRevert = [...done.keys()].sort().reverse().slice(0, steps);
    const reverted: string[] = [];
    for (const name of toRevert) {
      const m = byName.get(name);
      if (!m) throw new Error(`Applied migration ${name} has no file on disk`);
      try {
        await client.query('begin');
        await client.query(m.down);
        await client.query('delete from schema_migrations where name = $1', [name]);
        await client.query('commit');
        reverted.push(name);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Rollback of ${name} failed: ${(err as Error).message}`);
      }
    }
    return reverted;
  });
}

export async function migrationStatus(
  client: Client,
  dir = MIGRATIONS_DIR,
): Promise<{ name: string; applied: boolean }[]> {
  await ensureTable(client);
  const done = await applied(client);
  return loadMigrations(dir).map((m) => ({ name: m.name, applied: done.has(m.name) }));
}
