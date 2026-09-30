# Data collection policy (plan 0.4) - binding on engineering

Status: DRAFT - requires counsel sign-off and written adoption by the team.

## Priority order (ADR-001)
1. Signed partnership / data feeds
2. Publicly published flyers & official sources (facts only, unless licensed)
3. Crowd-sourced price reports / receipts
4. Automated collection from public web pages - **only** where terms, robots.txt and counsel allow
5. Manual field checks (baseline basket) - always permitted

## Rules
- **P1** Follow the priority order above.
- **P2** Before any automated collection from a domain: archive the site's Terms of Service and
  `robots.txt` (with date) under `docs/legal/sources/<retailer>/`, obtain counsel sign-off or
  written permission, and record the source in the Source Registry as `green`.
  Code enforces this: an adapter refuses to run unless `legal_status = green` and
  `kill_switch = false`.
- **P3** Collect only: price, name, size/unit, barcode, promo, availability, branch. **Not** images,
  descriptions, or flyer artwork unless licensed.
- **P4** Respect `robots.txt`; identify the bot (`QaribBot/1.0 (+https://[DOMAIN.qa]/bot; [LEGAL EMAIL])`);
  throttle to at most 1 request / 2 s / domain, off-peak; cache; stop at once on a cease-and-desist
  or block request.
- **P5** Never bypass logins, captchas, rate limits, IP blocks or encryption; never create retailer
  accounts to reach private APIs; never reverse-engineer mobile-app APIs without written permission.
  (Unauthorised access is an offence under Law 14/2014.)
- **P6** Takedown: any retailer can request removal via `[LEGAL EMAIL]`; the source is disabled
  within 2 business days (see `takedown-policy.md`).
- **P7** Competition: publish only public, current prices; never share one retailer's non-public
  pricing with another.
- **P8** Restricted categories (alcohol, tobacco; pork pending counsel) are never ingested into
  public views.

## Sign-off
| Name | Role | Date | Signature |
| ---- | ---- | ---- | --------- |
