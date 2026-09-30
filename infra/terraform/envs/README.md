# Environments (plan 1.3)

| Env | Azure | Purpose | Access |
| --- | ----- | ------- | ------ |
| local | none (`docker compose`; `docker-compose.stack.yml` = all production images) | developer machines | anyone |
| dev | resource group `rg-qarib-dev` | auto-deploy from main | engineers via pipeline |
| staging | `rg-qarib-staging` | release candidates, pen test, load test | pipeline + reviewers |
| prod | `rg-qarib-prod` | live | pipeline (approval) + break-glass |

Files per environment: `backend.hcl` (state location), `terraform.tfvars.example` (copy to `terraform.tfvars`).
Status: **NOT PROVISIONED** - needs the company Azure subscription (ADR-004/006) and the step 9.0 results.
