# Threat model (STRIDE) - skeleton, plan 8.1

Update on each major change. Seeded with the highest-risk items; flesh out in Phase 8.

| Asset / surface | Threat (STRIDE) | Mitigation |
| --------------- | --------------- | ---------- |
| Auth endpoints | Spoofing, brute force, credential stuffing | argon2id, rate-limit, lockout, email verify |
| Admin app | Elevation of privilege, tampering with legal status/kill-switch | SSO+MFA, IP allowlist, audit log, 4-eyes |
| Ingestion workers | Tampering (poisoned prices), legal breach via rogue source | Source Registry gate, outlier review, circuit breaker |
| Receipt uploads | Malware, PII leak (EXIF, card no.) | AV scan, EXIF strip, blur, private store, 7-day delete |
| Public API | DoS, scraping of our data, injection | WAF, rate-limit, zod validation, parametrised SQL |
| Search index | Info disclosure of restricted products | `public_products` DB view; index only from view |
| Secrets | Disclosure | Key Vault, gitleaks, no secrets in git |
| Backups | Disclosure / non-deletion of erased users | Encryption, 30-day expiry |
