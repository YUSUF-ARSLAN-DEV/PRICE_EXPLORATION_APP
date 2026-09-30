# Terraform layout (plan 9.3)

- `spike-azure-availability/` - throwaway sandbox for plan step 9.0. Destroy after use.
- `envs/dev|staging|prod/` - reserved for real environments. Empty until step 9.0 results are
  recorded in `docs/architecture/azure-availability.md` and ADR-006 is confirmed. Each env gets its
  own Azure subscription/resource group, its own state in a locked Blob container, and its own
  secrets (plan 1.3).

Rules: no console click-ops in staging/prod; state is remote and locked; no `*.tfvars` with secrets
committed (they are git-ignored); secrets come from Key Vault.
