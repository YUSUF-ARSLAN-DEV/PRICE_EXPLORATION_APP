# Record of Processing Activities (plan 0.3) - DRAFT v0.1

Controller: [COMPANY NAME] - Privacy Lead: [NAME] - [PRIVACY EMAIL]. Update whenever a new
personal field, purpose or vendor is added (Definition of Done, plan Appendix 3).

| # | Activity | Data subjects | Data categories | Purpose | Basis | Recipients | Transfers | Retention | Security |
| - | -------- | ------------- | --------------- | ------- | ----- | ---------- | --------- | --------- | -------- |
| 1 | Accounts | Registered users | email, password hash, locale | Account & sign-in | Consent / service | Azure (hosting), email provider | Qatar region | Until deletion + 30d | TLS, AES at rest, argon2id |
| 2 | Consent ledger | Registered users | user id, purpose, version, timestamp, truncated IP | Prove consent | Legal obligation | Azure | Qatar | Life of account + 1y | as above |
| 3 | Saved baskets / alerts | Registered users | items, thresholds, email | Features | Consent | Azure, email provider | Qatar | Until removed | as above |
| 4 | Search/basket history | Registered users (opt-in) | queries, timestamps | Convenience | Consent | Azure | Qatar | 90 days rolling | as above |
| 5 | Price reports / receipts | Contributors | photo (PII auto-blurred), user id | Price accuracy | Consent | Azure, OCR (in-region) | Qatar | image 7d; extracted price kept without user link after 90d | private bucket, AV scan, EXIF strip |
| 6 | Server & security logs | All visitors | truncated IP, UA, path, status | Security/ops | Legitimate operation | Azure Monitor | Qatar | 30 days | access-controlled |
| 7 | Analytics (opt-in) | Consenting visitors | pseudonymous events, truncated IP | Product improvement | Consent | Self-hosted analytics | Qatar | 13 months | as above |
| 8 | Support & privacy requests | Requesters | email, message | Respond to users | Legal obligation / legitimate | Email provider | per provider | 2 years | access-controlled |
