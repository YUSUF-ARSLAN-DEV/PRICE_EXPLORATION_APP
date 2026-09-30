import { Injectable, Logger } from '@nestjs/common';
import { Db } from '../db/db.service';
import { BlobStore } from '../reports/blob-store';

export interface MaintenanceReport {
  receipts_deleted: number;
  idempotency_deleted: number;
  search_log_deleted: number;
  email_tokens_deleted: number;
  refresh_tokens_deleted: number;
  retailer_claims_deleted: number;
  personal_data_purge: Record<string, number>;
}

/**
 * Daily retention enforcement (plan 0.9, 8.3) - the API side. The ingestion side (raw artefacts,
 * dead letters, price partitions) is `qarib-ingest maintenance`.
 */
@Injectable()
export class MaintenanceService {
  private readonly log = new Logger('maintenance');

  constructor(
    private readonly db: Db,
    private readonly blobs: BlobStore,
  ) {}

  async run(): Promise<MaintenanceReport> {
    // Receipt images: delete the blob FIRST, then forget the path (a crash never orphans a file
    // without a record, and never records a deletion that did not happen).
    const due = await this.db.query<{ price_report_id: string; receipt_blob_path: string }>(
      'select price_report_id, receipt_blob_path from receipts_due_for_deletion',
    );
    for (const r of due) {
      await this.blobs.delete(r.receipt_blob_path);
      await this.db.query(
        'update price_reports set receipt_deleted_at = now(), receipt_blob_path = null where id = $1',
        [r.price_report_id],
      );
    }
    const count = async (sql: string) => (await this.db.query(sql)).length;
    const searchLog = await this.db.one<{ n: string }>('select purge_search_log() as n');
    const purge = await this.db.query<{ entity: string; rows_affected: string }>(
      'select * from purge_expired_personal_data()',
    );
    const report: MaintenanceReport = {
      receipts_deleted: due.length,
      idempotency_deleted: await count(
        `delete from idempotency_keys where created_at < now() - interval '48 hours' returning 1`,
      ),
      search_log_deleted: Number(searchLog?.n ?? 0),
      email_tokens_deleted: await count(
        `delete from email_tokens where expires_at < now() - interval '7 days' returning 1`,
      ),
      refresh_tokens_deleted: await count(
        `delete from refresh_tokens where expires_at < now() - interval '7 days' returning 1`,
      ),
      retailer_claims_deleted: Number(
        (await this.db.one<{ n: number }>('select purge_retailer_claims() as n'))?.n ?? 0,
      ),
      personal_data_purge: Object.fromEntries(
        purge.map((p) => [p.entity, Number(p.rows_affected)]),
      ),
    };
    this.log.log(JSON.stringify(report));
    return report;
  }
}
