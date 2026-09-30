# Retention schedule (plan 0.9) - implemented as automated jobs in Phase 8

| Data | Retention |
| ---- | --------- |
| Account | until deletion, backups purged within 30 days |
| Search/basket history linked to account | 90 days rolling; user can turn off / clear |
| Anonymous analytics | 13 months max, IP truncated |
| Server logs with IP | 30 days |
| Uploaded receipts | extract prices, delete image within 7 days |
| Consent records | life of account + 1 year |
| Support / privacy requests | 2 years |
| Price history (non-personal) | indefinite |
| Raw ingestion artefacts (non-personal) | 90 days |
