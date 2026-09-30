# Security controls mapping (plan 0.7) - DRAFT

Purpose: use Qatar's National Information Assurance (NIA) standard and NCSA cloud guidance as the
control checklist. **Gap:** I have not mapped to the official NIA control IDs (need the current
NCSA documents); the table below uses control *families* and must be completed against them.
Action: obtain current NIA + NCSA cloud policy and fill the `NIA ref` column.

| Family | Control | Implemented by | Plan step | NIA ref | Status |
| ------ | ------- | -------------- | --------- | ------- | ------ |
| Governance | Named owner, risk register, policies | Privacy Lead, plan appendix 1 | 0.3, App.1 | TBD | partial |
| Asset mgmt / classification | Data classified (personal / non-personal), inventory | ROPA | 0.3 | TBD | drafted |
| Access control | SSO + MFA for admin/cloud, least privilege, 4-eyes on kill-switch | Entra ID, RBAC | 8.2 | TBD | planned |
| Cryptography | TLS 1.2+/1.3, AES at rest, CMK, Key Vault | Azure | 8.2, 9.2 | TBD | planned |
| Network security | Private endpoints, NSGs, WAF, DDoS protection | Azure | 9.2 | TBD | planned |
| Secure development | Code review, SAST, dependency/license/secret scanning | CI workflows | 1.2, 1.5 | TBD | **implemented (CI files)** |
| Vulnerability mgmt | Dependabot, Trivy, pen test | CI, 8.4 | 1.5, 8.4 | TBD | partial |
| Logging & monitoring | PII-free structured logs, alerts | Azure Monitor | 8.2, 9.5 | TBD | planned |
| Backup / DR | PITR, restore drills, RPO 15m / RTO 4h | Azure PG | 9.8 | TBD | planned |
| Incident mgmt | Runbook + tabletop | `docs/runbooks/breach-response.md` | 8.5 | TBD | drafted |
| Supplier mgmt | DPAs, sub-processor register | `docs/legal/subprocessors.md` | 0.3h | TBD | drafted |
| Privacy | Consent ledger, DSR APIs, retention jobs | Phase 6/8 | 6.4, 8.3 | TBD | planned |
