# Deploy, promote and roll back (plan 9.3, 9.4, 9.9)

Status: written and statically verified (terraform validate, trivy config, shellcheck, actionlint,
images built and smoke-tested locally). **Never executed against a real Azure subscription** - the
first real run is DEV and will surface gaps; log them in the plan Change Log.

## Architecture in one picture
```
Internet -> Azure DNS (.qa) -> Application Gateway WAF_v2 (TLS, OWASP 3.2, bot rules, admin IP allow-list)
   -> Container Apps env (VNet-integrated, Qatar Central)
        web    (public via gateway only)  --/api/v1 runtime proxy-->  api (internal)
        admin  (gateway only)                                          |-- clamav (internal, receipts)
        jobs: migrate, alerts, reindex, freshness, maintenance-*, matcher   |-- meilisearch (internal)
   -> PostgreSQL Flexible Server (private, no public access)   Blob storage (private endpoint, MI only)
   Key Vault (RBAC, private endpoint)   Log Analytics + alerts   ACR (signed images)
```

## A. First-time environment bring-up (per environment, in this order)
1. **Step 9.0 first**: run `infra/terraform/spike-azure-availability`, fill
   `docs/architecture/azure-availability.md`. Adjust `availability_zones`, `postgres_ha_mode`,
   `zone_redundant` in the tfvars to what Qatar Central really offers.
2. `terraform -chdir=infra/terraform/bootstrap apply` (once, admin) -> note the state account name in
   `infra/terraform/envs/<env>/backend.hcl`. Give the CI identity `Storage Blob Data Contributor` on it.
3. Copy `envs/<env>/terraform.tfvars.example` -> `terraform.tfvars`, fill it in (company subscription!).
4. `terraform -chdir=infra/terraform/stack init -backend-config=../envs/<env>/backend.hcl`
5. Create the registry + secrets first (apps cannot start without images):
   `terraform ... apply -var-file=... -target=module.network -target=module.security -target=module.data`
6. Push the first images to the new ACR (`az acr login`, then build + push `qarib-api|web|admin|ingest|matcher`
   with tag `bootstrap`), and **mirror the third-party images** into the ACR and pin digests:
   `az acr import -n <acr> --source docker.io/getmeili/meilisearch:v1.11 --image meilisearch:v1.11`,
   same for `clamav/clamav:1.4` (then point the `meili`/`clamav` container images at the ACR copies).
7. Full `apply` (still `enable_edge=false`).
8. Run the **migrate** job once: `az containerapp job start -g rg-qarib-<env> -n caj-qarib-<env>-migrate`
   (it applies migrations AND enables login for the `qarib_*` DB roles from Key Vault passwords).
9. Create the first admin: start a one-off API job with `ADMIN_EMAIL`/`ADMIN_PASSWORD` and command
   `node dist/jobs/run.js create-admin` (password >= 14 chars; rotate after first login).
10. Import the TLS certificate (PFX) into Key Vault, put its versionless secret id in `tls_certificate_secret_id`,
    set `enable_edge=true`, apply. Then `manage_dns=true` and delegate the `.qa` zone name servers at the registrar.
11. Configure admin **SSO + MFA** (Entra ID): enable Authentication on `ca-qarib-<env>-admin` (Container Apps
    "Authentication" blade, Conditional Access requiring MFA). The app itself only checks role=admin.
12. GitHub: create Environments `dev`, `staging`, `production` (required reviewers on production), add
    `AZURE_CLIENT_ID/TENANT_ID/SUBSCRIPTION_ID` secrets + federated credentials, variables `ACR_NAME`,
    `SOURCE_ACR_NAME`, `PUBLIC_URL`, `ADMIN_URL`, then set repo variable `DEPLOY_ENABLED=true`.

## B. Routine release
1. Merge to `main` -> CI green -> `Deploy` builds, **signs (cosign)** and attaches SBOM/provenance, deploys to **dev**.
2. Tag `vX.Y.Z` -> staging, then production (manual approval). Images are **promoted by digest, never rebuilt**;
   signatures are verified before rollout.
3. `scripts/deploy/deploy.sh` per environment: migrate job (must succeed) -> job images -> **API canary** ->
   **web canary** -> admin -> reindex -> smoke test.
4. Canary = new revision at 10 % for 10 min; automatic rollback if its 5xx rate > 2 % (>= 20 requests).

## C. Database changes (expand / contract)
Migrations run BEFORE the new code. Therefore each migration must work with the previous release:
add columns/tables/functions first (expand); remove or rename only in a later release after no code uses them
(contract). Never drop or rename in the same release that stops using it. The runner refuses to apply a modified
historical migration (checksum), so fix forward with a new migration.

## D. Rollback
- **Bad code, DB fine**: traffic is pinned to the old revision by the canary automatically. Manual:
  `az containerapp ingress traffic set -g <rg> -n ca-qarib-<env>-api --revision-weight <old-revision>=100`.
- **Bad migration**: fix forward (preferred). Down migrations exist for local use; on production restore is
  point-in-time (see `disaster-recovery.md`) - do not run `migrate down` on production data.
- **Bad source data**: disable the source (admin console kill switch) - prices vanish from every public view at once.
- **Terraform change**: revert the commit and apply; destructive plans need a second reviewer (`prevent_deletion_if_contains_resources`).

## E. Promotion checklist (plan 9.9) - tick before production
- [ ] Staging deployed from the exact release-candidate digest; smoke test green
- [ ] Migrations dry-run on a restored copy of production (timing + locks)
- [ ] `pnpm test`, Python tests, `terraform plan` reviewed (no surprise destroys)
- [ ] Load test run (`docs/runbooks/load-testing.md`) within SLOs
- [ ] Security headers/CSP unchanged (ZAP baseline green)
- [ ] Legal page versions and consent texts match `docs/legal/` (no draft banner if counsel approved)
- [ ] Kill switch verified on staging (disable a source -> disappears; release -> returns)
- [ ] Rollback rehearsed on staging this release cycle
- [ ] On-call informed; alerts routed; dashboards open
