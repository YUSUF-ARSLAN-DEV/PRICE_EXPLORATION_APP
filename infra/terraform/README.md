# Terraform (plan 9.3)

| Path | Purpose |
| ---- | ------- |
| `bootstrap/` | one-time: storage account for remote state (Entra-only, versioned, network-locked) |
| `stack/` | ONE environment = this root module + `envs/<env>/backend.hcl` + `envs/<env>/terraform.tfvars` |
| `modules/network` | VNet, delegated subnets, NSG, private DNS zones |
| `modules/data` | PostgreSQL Flexible Server (private), blob storage + lifecycle + private endpoint |
| `modules/security` | Key Vault, ACR, per-workload managed identities, role assignments, generated secrets |
| `modules/observability` | Log Analytics, App Insights availability test, alerts, action group, budget |
| `modules/apps` | Container Apps environment, web/admin/api/meili/clamav apps, scheduled jobs |
| `modules/edge` | Application Gateway WAF_v2 (TLS, OWASP, bot rules, admin IP allow-list) |
| `modules/dns` | `.qa` DNS zone + records, SPF/DMARC/DKIM/CAA |
| `spike-azure-availability/` | throwaway step 9.0 probe of Qatar Central service availability |

```bash
terraform -chdir=infra/terraform/stack init -backend-config=../envs/dev/backend.hcl
terraform -chdir=infra/terraform/stack plan -var-file=../envs/dev/terraform.tfvars
```
Bring-up order, releases and rollback: `docs/runbooks/deploy.md`. Architecture + cost: `docs/architecture/deployment.md`.

Checks run in CI and locally: `terraform fmt -check -recursive`, `terraform validate` for every root, Trivy IaC scan.
Rules: no console click-ops in staging/prod; state is remote and locked; `*.tfvars` are git-ignored (only `*.example` is committed);
secrets are generated into Key Vault, never typed into tfvars; `location` is pinned to `qatarcentral` (data residency) by a validation.
