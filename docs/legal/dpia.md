# Data Protection Impact Assessment (plan 0.3l) - DRAFT v0.1

Must be completed and signed before launch; refresh annually and on any major feature change.

## 1. Processing description
Consumer price-comparison service (see `plan.txt`). Personal data only for optional accounts,
alerts, saved baskets, history, receipt submissions, and security logs. Price data itself is not
personal data.

## 2. Necessity & proportionality
- Anonymous-first: core function needs no personal data.
- Minimisation: email + hash + language; no QID, payment, precise location, special-category data.
- Short retention (see `retention-schedule.md`).

## 3. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Residual |
| - | ---- | ---------- | ------ | ---------- | -------- |
| 1 | Account data breach | L | H | Argon2id, TLS, encryption at rest, private network, MFA admin, pen test | L |
| 2 | Baskets/history reveal religion, health or family status by inference | M | M | Off by default, 90-day retention, one-click clear, no profiling, no sharing with retailers | L |
| 3 | Receipt photos contain names, card/loyalty numbers, location (EXIF) | M | H | Auto-blur, strip EXIF, private storage, 7-day deletion, moderation | L |
| 4 | Cross-border processing by cloud/support staff | M | M | Qatar region, DPA, sub-processor register, counsel view | TBD |
| 5 | Email used for unwanted marketing | L | M | Consent per purpose, one-click unsubscribe, no marketing in v1 | L |
| 6 | Data retained after deletion (caches, index, backups) | M | M | Tested deletion job, backup expiry 30 days | L |
| 7 | Breach not notified in time | L | H | Runbook, rehearsal, NCGAA contact list | L |

## 4. Consultation
Counsel: [NAME/DATE]. Privacy Lead: [NAME/DATE]. Regulator consultation needed? [per counsel].

## 5. Sign-off
| Role | Name | Date |
| ---- | ---- | ---- |
| Privacy Lead | | |
| Counsel | | |
| Engineering lead | | |
