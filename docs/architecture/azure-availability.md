# Azure Qatar Central availability (plan step 9.0) - NOT YET RUN

The spike Terraform (`infra/terraform/spike-azure-availability`) now passes `terraform validate`; it still needs a real
subscription to apply. Procedure: `az login`, `terraform init`, then `terraform apply -target=<resource>` one resource at a
time so each failure names the missing service/SKU; record the result below; `terraform destroy` afterwards.

Run `infra/terraform/spike-azure-availability` (and portal checks) with a company Azure
subscription. Fill the table with real results; then confirm or amend ADR-006.

| Needed service | Why | Available in Qatar Central? | Tested on | SKU / notes |
| -------------- | --- | --------------------------- | --------- | ----------- |
| Container Apps (or App Service / AKS) | web, api, admin, jobs | ? | | |
| PostgreSQL Flexible Server 16 | main DB | ? | | HA zone-redundant? PITR? |
| PG extensions: pg_trgm, citext, vector, unaccent, pg_partman | search/matching/partitioning | ? | | |
| Azure Cache for Redis | cache, queues | ? | | |
| Blob Storage (+ CMK, lifecycle) | artefacts, receipts | ? | | |
| Key Vault | secrets, CMK | ? | | |
| Application Gateway v2 + WAF | edge protection | ? | | portal check |
| Azure DNS | `.qa` zone | ? | | DNSSEC? |
| Service Bus | queues | ? | | |
| Monitor / Log Analytics / App Insights | observability | ? | | |
| Container Registry | images | ? | | |
| Entra ID (SSO+MFA) | admin auth | global | | control plane location - counsel |
| Availability zones / second in-country region for DR | RPO/RTO | ? | | |

## Findings / exceptions
(none yet - log every gap here and in plan.txt Change Log)
