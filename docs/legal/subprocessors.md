# Sub-processor register (plan 0.3h) - DRAFT

A DPA must be signed before any vendor touches personal data. Publish the final list at
`[DOMAIN.qa]/subprocessors`.

| Vendor | Service | Data | Location | DPA signed? | Notes |
| ------ | ------- | ---- | -------- | ----------- | ----- |
| Microsoft Azure | Hosting, DB, storage, monitoring | all | Qatar Central (verify per service, step 9.0) | NO | Global control-plane services (Entra ID, support) may process outside Qatar - counsel to review |
| Email provider TBD | Transactional email | email, message | TBD | NO | Prefer in-region or documented safeguards |
| GitHub | Source code, CI | none (no personal data in repo) | US | n/a | Never commit personal data |
| Error tracking (self-hosted) | Exceptions | scrubbed | Qatar | n/a | PII scrubbing enforced |
