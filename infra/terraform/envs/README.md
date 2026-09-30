# Environments (plan 1.3)

| Env     | Azure subscription | Purpose                        | Access                      |
| ------- | ------------------ | ------------------------------ | --------------------------- |
| local   | none (docker)      | developer machines             | anyone                      |
| dev     | TBD                | auto-deploy from feature/main  | team                        |
| staging | TBD                | pre-prod, mirrors prod         | team                        |
| prod    | TBD                | live                           | SSO + MFA, least privilege  |

Status: NOT PROVISIONED. Blocked on step 9.0 (Azure availability spike) and the company
registration (Azure billing account should belong to the company, ADR-004).
