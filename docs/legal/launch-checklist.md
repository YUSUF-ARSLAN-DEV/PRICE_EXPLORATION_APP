# Launch go / no-go gate (plan 0.8, 10.5)

Public launch is blocked until every box is ticked **and** recorded as a Change Log entry in `plan.txt`.
Nothing here is a legal opinion; items marked **HUMAN** cannot be closed by engineering.

Legend: `[x]` = verified by an automated check or a recorded run (evidence given) · `[ ]` = open ·
`(beta)` = must be closed before the soft launch starts, not only before public launch.

## A. Company, licence, domain (HUMAN)

- [ ] (beta) Company + trade licence in place, operating activity covers a price-information service (0.2)
- [ ] (beta) `.qa` domain registered in the company's name (see `company-and-domain-checklist.md`)
- [ ] (beta) Azure subscription owned by the company; `docs/architecture/azure-availability.md` step 9.0 run
      against it and the result recorded (Qatar Central availability of every SKU we need)

## B. Legal review (HUMAN)

- [ ] (beta) Counsel opinion on `counsel-brief.md` received; open issues closed (0.1)
- [ ] (beta) Privacy Notice + Terms live in Arabic **and** English, counsel-approved (drafts in this folder)
- [ ] (beta) Arabic legal and UI texts reviewed by a native speaker (UI strings in `apps/web/src/i18n/ar.ts`
      are machine-assisted drafts; nothing has been reviewed yet)
- [ ] DPIA + ROPA signed by the accountable person; sub-processor register published; DPAs signed
- [ ] Notification route to the regulator and breach contacts verified (`breach-response.md`)
- [ ] Every live source is `green` in the Source Registry with an `approval.md` (today: all sources are red;
      no retailer has been approached)

## C. Product behaviour (technical, verified)

- [x] Cookie consent works; no analytics or third-party script before consent
      (`e2e/tests/consent-security.spec.ts`; there is no analytics vendor configured at all)
- [x] Alcohol / tobacco / pork exclusion enforced in the DB view and tested
      (`packages/db/src/db.test.ts`, `services/ingest` restricted-product tests)
- [x] Price disclaimer + "last updated" on every price, on phones too
      (`e2e/tests/public.spec.ts`; mobile project found and fixed a hidden "Updated" column)
- [x] Deletion + export flows tested end to end in a browser
      (`e2e/tests/account.spec.ts`, EN and AR) and in the DB (`erase_user` drift-guard test)
- [x] Kill switch removes a source's prices from public results immediately and restores them on release
      (`e2e/tests/admin.spec.ts`)
- [x] Personal data never reaches the worker or read-only roles (`packages/db/src/db.test.ts`)
- [x] Accessibility: axe WCAG 2.2 AA, no serious/critical violations on the eight key pages, EN/AR,
      light/dark, plus 320 px reflow (`e2e/tests/a11y.spec.ts`). **Automated only**: manual AT testing is
      still required (`docs/qa/usability-test-plan.md`)
- [x] Lighthouse (mobile, throttled) on key pages: performance 95-100, accessibility 100, best practices 96,
      SEO 100 (`pnpm --filter @qarib/e2e lighthouse`, run 2026-09-30 against the local production images)
- [x] Load: 200 search req/s + 50 product pages/s for 40 s on 15,000 products / 72,000 prices: search p95 67 ms
      (budget 300 ms), 0 errors (`load/api.js`; single local machine, **not** the Azure SKU sizing)
- [x] Chaos: Meilisearch down -> Postgres fallback; database down -> clean 503 problem documents, liveness
      unaffected, automatic recovery (`e2e/tests/chaos.spec.ts`; found and fixed a real crash)
- [ ] Sponsored-content labelling rule live, or no sponsored content (policy in `docs/business/monetisation.md`;
      no sponsored placement exists in the product)

## D. Data quality

- [ ] (beta) Field-team accuracy audit: >= 95 % over >= 300 prices across >= 3 retailers
      (`qarib-ingest qa-audit`; the tool is built and tested, **no real audit has been run** because there is
      no real data yet)
- [ ] Matching precision on a real, hand-labelled gold set >= 98 % (the committed gold set is synthetic)

## E. Security

- [x] Dependency audit, secret scan, Trivy fs/config in CI (`security.yml`); ZAP baseline run locally with
      0 FAIL and triaged warnings (`.zap/rules.tsv`)
- [ ] Independent penetration test against staging: no open High/Critical (`docs/security/pentest-scope.md`;
      **HUMAN** - a vendor must be engaged)
- [ ] NIA control IDs mapped in `docs/security/controls.md` (the column is empty)
- [ ] Admin SSO/MFA enabled through Entra (manual step; admin login today is email + password)

## F. Operations

- [ ] (beta) Terraform applied to dev, then staging, canary deploy rehearsed (`docs/runbooks/deploy.md`).
      **Nothing has ever been provisioned on Azure.**
- [ ] (beta) Restore drill performed and timed (`disaster-recovery.md`)
- [ ] (beta) Takedown inbox monitored by a named human; kill-switch drill on staging within 7 days
- [ ] Breach runbook rehearsed (tabletop)
- [ ] Alerts reach a human phone; on-call rota published

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Accountable executive | | | |
| Privacy lead (DPO or equivalent) | | | |
| Counsel | | | |
| Engineering lead | | | |
