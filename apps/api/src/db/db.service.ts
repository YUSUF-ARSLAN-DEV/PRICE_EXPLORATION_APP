import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { CONFIG, Config } from '../config';

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(CONFIG) cfg: Config) {
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      max: 10,
      // Demo retailers are hidden from public views unless explicitly enabled (dev only).
      options: cfg.showDemo ? '-c qarib.show_demo=on' : undefined,
      connectionTimeoutMillis: 5_000,
    });
    // An idle client whose connection is dropped (DB restart, failover) emits 'error'. Unhandled, that
    // crashes the whole process; handled, the pool discards the client and reconnects on the next query.
    this.pool.on('error', (err) => new Logger('Db').warn(`idle client error: ${err.message}`));
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  /** Run `fn` in a transaction; `actor` is recorded by audit triggers (qarib.actor). */
  async tx<T>(fn: (c: PoolClient) => Promise<T>, actor?: string): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      if (actor) await c.query(`select set_config('qarib.actor', $1, true)`, [actor]);
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
