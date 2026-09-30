# Threat model (STRIDE) - plan 8.1

Status: v1.0, reviewed by the engineering team only. Update on every major change (new endpoint class,
new personal field, new vendor, new ingestion method). Owner: tech lead.

## Assets
| Asset | Why it matters |
| ----- | -------------- |
| Account data (email, password hash, consents, baskets, alerts, history) | Personal data under PDPPL; shopping history can reveal religion/health by inference |
| Receipt images | May contain names, card/loyalty numbers, location |
| Source Registry (`sources`, kill switches, approvals) | Wrongly enabling a source = legal exposure (Cybercrime Law, contract, IP) |
| Price data integrity | Wrong prices mislead consumers (Consumer Protection Law) |
| Admin access | Can publish/hide prices, change legal status, see takedowns |
| Secrets (DB, JWT, SMTP, Azure) | Full compromise |

## Trust boundaries
Internet -> App Gateway WAF -> web (Next.js) -> API -> Postgres/Blob/Redis; ingestion workers -> Postgres
(role `qarib_worker`, no personal data); admin console -> API (role=admin, behind SSO/MFA + IP allow-list in prod).

## Threats and mitigations
| Surface | Threat (STRIDE) | Mitigation (implemented unless marked) | Test |
| ------- | --------------- | -------------------------------------- | ---- |
| Auth | Spoofing: credential stuffing, brute force | argon2id; per-IP auth throttle (10/min); per-account lockout (5 fails / 15 min); identical errors + equalised timing for unknown users | `auth.spec`, `ratelimit.spec` |
| Auth | Spoofing: stolen refresh token | rotation + reuse detection revokes the whole token family; httpOnly/SameSite cookies | `auth.spec` |
| Auth | Information disclosure: account enumeration | register/forgot always 202; same login error | `auth.spec` |
| Session | Tampering: CSRF | SameSite=Lax + required `X-Qarib-CSRF` header + Origin allow-list; Bearer clients exempt | `auth.spec` |
| Session | Elevation: forged/unsigned JWT (`alg:none`, wrong key, wrong `typ`) | HS256 pinned, `typ` claim checked, user re-loaded from DB each request (deleted users lose access immediately) | `auth.spec` |
| Admin | Elevation of privilege | role check on every admin route; **SSO+MFA + IP allow-list at the edge (Phase 9 - NOT in the app)** | `admin.spec` |
| Admin | Tampering: flipping a source to `green` | four-eyes: a second admin must approve; DB CHECK constraints need approval evidence; every change audited with actor | `admin.spec`, `db.test` |
| Ingestion | Legal: scraping an unapproved/blocked site | batch runner + `record_price()` refuse non-green/killed sources; robots.txt fail-closed; circuit breaker disables the source after 3x 403/429/CAPTCHA; no evasion path | ingest pytest |
| Ingestion | Tampering: poisoned/garbage feed | schema validation, dead letters, abort batch at >30 % invalid, outlier hold (>50 % move), sanity bounds | ingest pytest |
| Uploads | Malware, script-as-image, oversized files | magic-byte sniffing (never client MIME), 5 MB cap, ClamAV INSTREAM (fails closed; mandatory in prod), private storage, 7-day deletion | `reports.spec` |
| Uploads | Information disclosure: EXIF/GPS, PII in photos | metadata stripped before storage; **no automatic blurring of names/card numbers (NOT implemented)** - moderator-only access + 7-day retention | `reports.spec` |
| Public API | DoS / scraping of our data | WAF (Phase 9), global throttle 120/min/IP, body limit 256 kB, search capped at 200 rows | `ratelimit.spec`, `platform.spec` |
| Public API | Injection (SQL/LIKE/JSON) | parameterised SQL only, zod validation on every input, LIKE metacharacters escaped | `search.spec` |
| Search | Information disclosure of restricted/hidden data | only `public_*` views are read; index built from views; killed sources disappear even before re-index | `search.spec`, `meili.spec` |
| Data store | Privilege abuse via compromised component | roles: worker cannot read personal tables; readonly sees views only; API cannot DDL or edit prices/audit | `db.test` (roles) |
| Data store | Non-deletion after erasure | `erase_user()` covers every table referencing users; drift-guard test fails when a new one appears | `db.test` (drift guard) |
| Logs | Information disclosure | access log has no query strings, cookies, emails, bodies; IP truncated to /24 | `platform.spec` |
| Email | Abuse: spam/relay, consent | per-alert consent check, one-click unsubscribe, quiet hours, 24 h cooldown | `alerts.spec` |
| Web | XSS / clickjacking | nonce CSP (`strict-dynamic`, no unsafe-eval in prod), React escaping, JSON-LD `<` escaped, `frame-ancestors 'none'` | `lib.test` |
| Web | Third-party leakage | no third-party scripts/fonts/analytics by default; analytics script only after opt-in and only to our own origin | `components.test` |
| Supply chain | Malicious/vulnerable dependency | Dependabot, `pnpm audit`, pip-audit, Trivy, license check, CodeQL, gitleaks in CI | CI |
| Backups | Disclosure / resurrecting erased data | encryption at rest; backups expire in 30 days (infra, Phase 9) | runbook |
| Takedown process | Repudiation: no proof a request was handled | `takedown_requests` + `audit_log` with timestamps and actors | `admin.spec` |

## Residual risks (accepted or open)
1. No WAF / DDoS protection until Phase 9 infrastructure exists.
2. Receipt images are not auto-blurred.
3. Admin MFA depends on the identity provider configured in Phase 9.
4. No independent penetration test yet (plan 8.4): scope in `pentest-scope.md`.
5. Prayer-time quiet hours for alert emails are not implemented (only 23:00-07:00).
