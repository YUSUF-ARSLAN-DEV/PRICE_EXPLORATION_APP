# Operations: SLOs, alerts, on-call, routine (plan 9.5, 11.2)

## Service level objectives
| SLO | Target | Measured by | Alert |
| --- | ------ | ----------- | ----- |
| Availability (public site) | 99.5 % monthly | App Insights availability test from >= 3 locations | `alert-*-availability` (sev 0) |
| API errors | < 1 % 5xx | access-log query in Log Analytics | `alert-*-api-5xx` (sev 1) |
| Search latency | p95 < 300 ms | access log `ms` field; load test | dashboard + weekly review |
| Data freshness | each approved source within its target (feeds 48 h, flyers 8 d) | `freshness` job | `alert-*-freshness-breach` (sev 2) |
| Match quality | auto-match precision >= 97 % | gold set in CI + weekly audit sample | review queue backlog |

## Alert routing
All alerts -> action group `ag-qarib-<env>-oncall` (email + optional webhook to Teams/PagerDuty/WhatsApp bridge).
Severity 0/1 page immediately; 2 next business morning. Every alert links to a section below.

| Alert | First steps |
| ----- | ----------- |
| availability / api-5xx | Open Log Analytics; `ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'api'`; last deploy? roll back (deploy.md D); DB reachable? (`/v1/health`) |
| freshness-breach | `qarib-ingest health` / admin "Source health": did the last batch fail (invalid ratio)? feed late? Contact the partner; do NOT work around blocks |
| source-auto-disabled | Circuit breaker hit repeated 403/429/CAPTCHA. **Never bypass.** Contact the retailer/counsel; release the kill switch only with written permission |
| job-failures | `az containerapp job execution list`, read logs, re-run manually once |
| pg-cpu / pg-storage | scale SKU/storage (Terraform), look for runaway queries (`log_min_duration_statement` = 500 ms) |
| budget | check cost analysis; scale-downs; see `docs/architecture/deployment.md` cost section |

## Daily / weekly / monthly / annual (plan 11.2)
**Daily** (10 min): admin console - source health, held prices, match queue, dead letters, takedown inbox (acknowledge <= 1 business day).
**Weekly**: accuracy audit (field team samples vs shelf; `docs/runbooks/data-quality.md`), release, cost review, source-legal review, ZAP report.
**Monthly**: retention verification (`MaintenanceService` output), access review (`secrets-and-access.md`), dependency updates, privacy-request stats.
**Quarterly**: restore drill (`disaster-recovery.md`). **Annual**: pen test, DPIA refresh, policy review, DR test.

## Scheduled jobs (Container Apps Jobs, UTC)
| Job | Schedule | Purpose |
| --- | -------- | ------- |
| alerts | */15 | price-alert emails (quiet hours 23:00-07:00 Qatar) |
| reindex | */30 | rebuild Meilisearch from public views |
| freshness | */30 | SLO watchdog |
| matcher | hourly :15 | match new listings |
| maintenance-ingest | 01:00 | price partitions, artefact/dead-letter retention, personal-data purge |
| maintenance-api | 01:30 | receipts (7 d), idempotency keys, tokens, search-log minimisation |
| migrate | manual (release) | schema + DB role logins |
Ingestion of each approved source: add one scheduled job per source (`qarib-ingest run-feed ...`) only after the Source Registry row is green.

## Rate limiting note
The API throttles per replica (in-memory). With N replicas the effective limit is N x the setting; the WAF is the
primary volumetric defence. A shared limiter (Redis) is a known follow-up (see deployment.md "Known gaps").
