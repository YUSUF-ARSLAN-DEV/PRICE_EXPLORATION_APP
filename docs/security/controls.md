# Security controls mapping (plan 0.7, 8.2) - v1.0

**Gap that remains:** the `NIA ref` column is empty. It needs the current National Information Assurance
(NIA) standard and NCSA cloud-security policy documents (obtain from NCSA) to map control identifiers.
Families below are generic. Status values: IMPLEMENTED (code + test), PLANNED (Phase 9/10), OPEN
(needs a person/vendor), N/A.

| Family | Control | Implemented by | Evidence | NIA ref | Status |
| ------ | ------- | -------------- | -------- | ------- | ------ |
| Governance | Named owners, risk register, policies | `plan.txt` App. 1, this folder, Privacy Lead | docs | TBD | partial (owners TBD) |
| Asset mgmt / classification | Personal vs non-personal data inventory | `docs/legal/ropa.md`, `[PII: ...]` column comments | `db.test` (PII comment + drift guard) | TBD | IMPLEMENTED |
| Access control | Least privilege in the database | roles `qarib_api`, `qarib_worker`, `qarib_readonly` (migration 0011) | `db.test` (roles) | TBD | IMPLEMENTED |
| Access control | Admin authorisation; four-eyes on legal status | `AdminGuard`, `decide_source_change()` | `admin.spec` | TBD | IMPLEMENTED |
| Access control | SSO + MFA + IP allow-list for admin / cloud | Entra ID Conditional Access, App Gateway rules | - | TBD | PLANNED (Phase 9) |
| Authentication | Password storage, lockout, session rotation, reset | argon2id, lockout, refresh rotation with reuse detection | `auth.spec` | TBD | IMPLEMENTED |
| Cryptography | TLS 1.2+/1.3, HSTS, secure cookies | App Gateway listener policy, helmet/Next headers, `COOKIE_SECURE` | `platform.spec`, config | TBD | IMPLEMENTED (app) / PLANNED (TLS terminate) |
| Cryptography | Encryption at rest, CMK, Key Vault secrets | Azure Postgres/Blob/Key Vault | `infra/terraform` | TBD | PLANNED (Phase 9) |
| Network security | Private endpoints, NSGs, WAF, DDoS protection | Terraform | `infra/terraform` | TBD | PLANNED (Phase 9) |
| Application security | Input validation, output encoding, CSRF, CSP, rate limits | zod, CSP nonce, CSRF guard, throttler | `search/platform/auth/lib` tests | TBD | IMPLEMENTED |
| Secure development | Review, SAST, dependency/licence/secret scanning | GitHub workflows (CodeQL, pnpm audit, pip-audit, Trivy, gitleaks) | CI | TBD | IMPLEMENTED |
| Vulnerability mgmt | Dependabot, weekly DAST, pen test | `security.yml`, `dast.yml`, `pentest-scope.md` | CI | TBD | partial (pen test OPEN) |
| Logging & monitoring | PII-free logs, audit trail, alerting | request logger, `audit_log` triggers, Azure Monitor | `platform.spec`, `db.test` | TBD | IMPLEMENTED (app) / PLANNED (alerts) |
| Backup / DR | PITR, restore drills, RPO 15 min / RTO 4 h | Azure PG, `runbooks/disaster-recovery.md` | - | TBD | PLANNED (Phase 9) |
| Incident mgmt | Runbook, breach notification, tabletop | `runbooks/breach-response.md` | - | TBD | drafted (tabletop OPEN) |
| Supplier mgmt | DPAs, sub-processor register | `docs/legal/subprocessors.md` | - | TBD | drafted (DPAs OPEN) |
| Privacy engineering | Consent ledger, export, erasure, retention jobs | API `/me/*`, `erase_user()`, `MaintenanceService` | `privacy.spec`, `maintenance.spec`, `db.test` | TBD | IMPLEMENTED |
| Data handling | Malware scanning and metadata removal for uploads | `reports/upload.ts` + ClamAV | `reports.spec` | TBD | IMPLEMENTED (ClamAV server PLANNED) |
