# Sub-processor register (plan 0.3h) - DRAFT

A DPA must be signed before any vendor touches personal data. Publish the final list at
`[DOMAIN.qa]/subprocessors`.

| Vendor | Service | Data | Location | DPA signed? | Notes |
| ------ | ------- | ---- | -------- | ----------- | ----- |
| Microsoft Azure | Hosting, DB, storage, monitoring | all | Qatar Central (verify per service, step 9.0) | NO | Global control-plane services (Entra ID, support) may process outside Qatar - counsel to review |
| Email provider TBD | Transactional email | email, message | TBD | NO | Prefer in-region or documented safeguards |
| GitHub | Source code, CI | none (no personal data in repo) | US | n/a | Never commit personal data |
| Error tracking (self-hosted) | Exceptions | scrubbed | Qatar | n/a | PII scrubbing enforced |
| Meilisearch (self-hosted on Azure) | Search index of PUBLIC product data only | none (no personal data) | Qatar Central | n/a | Not a processor of personal data |
| ClamAV (self-hosted) | Malware scan of receipt uploads | receipt images (transient) | Qatar Central | n/a | In-house; no third party sees the file |
| Anthropic API (optional, OFF by default) | LLM tie-break for borderline product matches | product-name strings only, never user data | outside Qatar | NO | Needs counsel approval before enabling (`qarib-match run --llm`) |
