# Disaster recovery (plan 9.8)

Targets: **RPO <= 15 minutes, RTO <= 4 hours** for the database; stateless tiers are rebuilt from Terraform + signed images.
Data residency: backups stay in Qatar (`geo_redundant_backup_enabled = false`). If Qatar Central offers no second
in-country region, the residual risk (regional outage = downtime until recovery) is **accepted and recorded** here.

## What is where
| Asset | Protection | Restore path |
| ----- | ---------- | ------------ |
| PostgreSQL | Azure automated backups + point-in-time restore (PITR), retention 7/14/35 days (dev/staging/prod), zone-redundant HA in prod if Qatar Central supports it | PITR to a NEW server, then repoint |
| Receipts / raw artefacts | short-lived by design (7 / 90 days) | not restored; re-ingest feeds if needed |
| Meilisearch index | rebuildable | `reindex` job |
| Secrets | Key Vault soft-delete 90 days + purge protection | recover secret |
| Infrastructure | Terraform state (versioned, 30-day blob retention) | `terraform apply` |
| Images | ACR, signed | re-deploy previous digest |
| Erased users | backups expire; restored data must be **re-erased** | see below |

## Scenario A - data corruption / bad migration (most likely)
1. Stop writes: scale jobs to 0 (`az containerapp job stop`), put the API into maintenance by pointing web at a static page (or scale api to 0).
2. Choose the restore time T (just before the bad change; audit_log and `ingestion_batches` help).
3. `az postgres flexible-server restore --resource-group rg-qarib-<env> --name psql-qarib-<env>-restored --source-server psql-qarib-<env> --restore-time <T>`
4. Verify (`select count(*)` on key tables, `pnpm db:status`-style check via the migrate job in `status` mode).
5. Point `database-url-*` secrets at the restored server (or rename), restart apps, re-enable jobs.
6. **Privacy step**: any user erased after T reappears. Re-run erasure for every such user: the API logs
   `{"event":"user.erased","user_id":...}` (pseudonymous id only) - query Log Analytics
   `ContainerAppConsoleLogs_CL | where Log_s has 'user.erased' and TimeGenerated > datetime(<T>)` and run
   `select erase_user('<id>')` for each (the prod log retention is 35 days = backup retention). Re-apply unsubscribes
   (`consents` rows after T are lost too). Document the incident; counsel decides whether notification is needed.

## Scenario B - region/service outage
Decision point at 30 minutes: wait for Azure, or rebuild in a different in-country environment. Out-of-country recovery is NOT
allowed without counsel sign-off (PDPPL cross-border rules). Communicate via the status page / social accounts.

## Scenario C - compromised credentials
Rotate per `secrets-and-access.md`, revoke all refresh tokens (`update refresh_tokens set revoked_at = now()`),
disable admin accounts, start `breach-response.md`.

## Restore drill (quarterly - plan 8.2) - record every run
| Date | Environment | Scenario | Backup age used | Time to restore | Problems found | Owner |
| ---- | ----------- | -------- | --------------- | --------------- | -------------- | ----- |
| (none yet - first drill due before public launch) | | | | | | |

Drill script: restore to `psql-qarib-drill`, run the migrate job in `status` mode against it, run a read-only smoke
(`qarib-ingest health`, search API against the restored DB via a temporary API revision), time it, delete the server.
