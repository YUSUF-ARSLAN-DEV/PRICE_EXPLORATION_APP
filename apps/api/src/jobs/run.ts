import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AlertsService } from '../alerts/alerts.service';
import { Db } from '../db/db.service';
import { MeiliIndexer } from '../search/meili.indexer';
import { MaintenanceService } from './maintenance.service';
import { hashPassword } from '../auth/auth.service';

/**
 * Scheduled jobs, run as one-shot processes by cron / Azure Container Apps Jobs:
 *   alerts       every ~15 min  - send due price-alert emails
 *   reindex      after ingestion - rebuild the Meilisearch index from public_products
 *   maintenance  daily          - receipt + idempotency + search-log + personal-data retention
 *   create-admin once           - ADMIN_EMAIL / ADMIN_PASSWORD env, creates/promotes an admin
 */
async function main(job: string | undefined): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const db = app.get(Db);
    switch (job) {
      case 'alerts':
        console.log(JSON.stringify(await app.get(AlertsService).evaluate()));
        break;
      case 'reindex':
        console.log(`indexed ${await app.get(MeiliIndexer).reindex()} products`);
        break;
      case 'maintenance':
        console.log(JSON.stringify(await app.get(MaintenanceService).run()));
        break;
      case 'create-admin': {
        const email = process.env.ADMIN_EMAIL?.toLowerCase();
        const password = process.env.ADMIN_PASSWORD;
        if (!email || !password || password.length < 14)
          throw new Error('set ADMIN_EMAIL and ADMIN_PASSWORD (>= 14 chars)');
        const pw = await hashPassword(password);
        await db.query(
          `insert into users (email, pw_hash, role, email_verified_at) values ($1, $2, 'admin', now())
           on conflict (email) do update set role = 'admin', pw_hash = excluded.pw_hash, email_verified_at = now(), deleted_at = null`,
          [email, pw],
        );
        console.log('admin ready (enable MFA at the identity provider in production)');
        break;
      }
      default:
        throw new Error('usage: run.ts alerts | reindex | maintenance | create-admin');
    }
  } finally {
    await app.close();
  }
}

main(process.argv[2]).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
