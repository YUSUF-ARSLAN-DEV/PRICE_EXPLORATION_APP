# Deployment architecture (Phase 9) - Azure Qatar Central

Source of truth: `infra/terraform` (`stack` = one environment; `modules/*`; `envs/*` = per-env backend + tfvars).
Validated with `terraform validate` (azurerm ~> 4.0), `terraform fmt`, Trivy IaC scan (no HIGH/CRITICAL).
**Not applied anywhere yet** - no Azure subscription was available; step 9.0 results may force changes.

## Components
| Layer | Azure service | Notes |
| ----- | ------------- | ----- |
| Edge | DNS zone (.qa), Application Gateway WAF_v2, public IP | OWASP 3.2 + bot rules, TLS 1.2+ (policy 2022), admin host allow-listed by CIDR, http->https |
| Compute | Container Apps (VNet-integrated, workload profile Consumption) | web + admin public **only via the gateway IP**; api, meilisearch, clamav internal |
| Jobs | Container Apps Jobs | migrate (manual), alerts, reindex, freshness, matcher, two maintenance jobs |
| Data | PostgreSQL Flexible Server 16 (private, VNet-injected, PITR) | extensions allow-listed: pg_trgm, citext, vector, unaccent; no geo-redundant backup (residency) |
| Files | Storage account (ZRS, private endpoint, Entra auth only) | `receipts`, `raw-artefacts`, lifecycle safety nets (8 d / 95 d) |
| Secrets | Key Vault (RBAC, purge protection, private endpoint) | workload identities read via references |
| Images | ACR (Standard), signed with cosign | promotion by digest |
| Observability | Log Analytics (30 d), App Insights availability test, scheduled-query + metric alerts, budget | see `runbooks/operations.md` |

## Network
VNet `10.40.0.0/16`: apps `/23` (delegated to Microsoft.App), postgres `/24` (delegated), private endpoints `/24`, gateway `/24`.
Postgres NSG admits only the apps subnet on 5432. Private DNS zones for postgres, blob, key vault.

## Decisions recorded
| ID | Decision | Why |
| -- | -------- | --- |
| ADR-008 | Container Apps (not AKS / App Service) | Scale-to-zero jobs, revisions + traffic split for canaries, no cluster to patch. Re-evaluate if we need sidecars/GPU/daemon sets. Must be confirmed available in Qatar Central (step 9.0); fallback = App Service for Containers or AKS |
| ADR-009 | No Redis in v1 | Nothing needs it: sessions are DB-backed, search cache not required at this scale, jobs are cron-style. Consequence: rate limits are per replica (see operations.md). Add Azure Cache for Redis when a shared limiter/cache is needed |
| ADR-010 | Meilisearch on Container Apps with scratch storage | Index is fully rebuildable from `public_products` (30-min reindex job); API falls back to Postgres search if it is down |
| ADR-011 | Web proxies `/api/v1` to the API at **runtime** (route handler), API internal | One origin for the browser (no CORS, first-party cookies); the same image works in every environment (API_URL at runtime; Next rewrites would be frozen at build time) |
| ADR-012 | No OpenTelemetry tracing in the app | Request URLs carry search terms; the PII-free access log + platform metrics are enough for the SLOs. Revisit with a scrubbing span processor |
| ADR-013 | DB access by password per role (Key Vault), not Entra tokens | The `pg` / `psycopg` drivers in use do not do token refresh; roles are least-privilege and rotated by the migrate job |

## Sizing and cost (plan 9.7) - ESTIMATE ONLY
No Azure price calculator was consulted and Qatar Central prices may differ: treat the numbers as order-of-magnitude.
| Environment | Shape | Rough monthly (USD) |
| ----------- | ----- | ------------------- |
| dev | B1ms Postgres, scale-to-zero web, 1 api, WAF Detection | 150-300 |
| staging | D2ds Postgres, 1-3 replicas | 350-600 |
| production | D2ds Postgres + HA, 2-6 replicas, WAF v2, ZRS storage | 600-1,200 (target was 400-900: likely exceeded once HA + WAF + ClamAV (3 GiB) are on) |
Budgets and 50/80/100 % alerts are provisioned (`monthly_budget`). Biggest levers: Postgres HA, Application Gateway capacity units, ClamAV memory, log volume.

## Known gaps / not built
- Shared rate limiter (Redis); per-replica throttling only.
- Automatic admin SSO/MFA configuration (manual Entra step; documented in deploy.md).
- ClamAV signature updates rely on the image's freshclam; mirror + pin digest before production.
- Third-party images (meilisearch, clamav) pulled from Docker Hub by default: mirror into ACR first (deploy.md step 6).
- Terraform has never been planned/applied against real Azure; expect provider/region corrections.
- No second in-country region: a regional outage means downtime until recovery (accepted residual risk).
