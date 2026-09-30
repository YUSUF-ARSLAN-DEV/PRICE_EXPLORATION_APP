# Monetisation policy (plan 11.4)

**Status:** draft policy for counsel review. **Nothing in this document is implemented in the product:** there
are no ads, no sponsored placements, no affiliate links and no paid retailer features today. This file exists
so that when revenue is added it is added inside rules that were agreed first.

## Non-negotiables (these never change without a Change Log entry and counsel sign-off)

1. **Personal data is never sold, rented, shared for advertising or used to build audience segments.**
   Not in aggregate-for-a-fee form either, unless it is non-personal and passes the k >= 20 rule used for
   popular searches.
2. **Nobody can pay to change the price shown, hide a competitor's price, or alter organic ranking.**
   Ranking inputs are relevance, number of stores selling the item, popularity and the price itself
   (`apps/api/src/search/search.service.ts`). No input may be a commercial relationship.
3. **Anything paid is labelled in the same language as the page, next to the item** ("Sponsored" /
   «ممول»), visually distinct, and never placed inside the price table or the "cheapest" badge logic.
4. **Retailers get no privileged access to shopper data.** A retailer dashboard, if built, shows only
   aggregates over at least 20 shoppers and never individual searches, baskets or accounts.
5. **Advertising claims are substantiated.** "Cheapest" is only ever a statement about the stores and
   products we cover, on the date shown, with the methodology page linked (`/about`). No "cheapest in
   Qatar" headline.
6. **The price data is free for shoppers.** Monetisation must not put basic search and comparison behind a
   paywall.

## Options, in the order we would consider them

| # | Option | Why it fits | Conditions before it ships |
|---|---|---|---|
| 1 | **Retailer subscription for tools** (claimed-store dashboard: freshness, coverage, how often its items are compared; feed health; correction workflow) | Revenue comes from retailers for tools about *their own* data; no effect on what shoppers see | Claim verified (`retailer-onboarding.md`); contract says no effect on ranking or price display; aggregates only, k >= 20 |
| 2 | **Labelled promoted placements** outside the results (e.g. a clearly marked banner on the home page or an "offers this week" slot fed by retailer-supplied flyers) | Familiar to retailers | Label rule live and tested in E2E; separate from organic lists; frequency caps; counsel review of the advertising rules; a public "how sponsored content works" paragraph |
| 3 | **Affiliate click-outs** for retailers with online shops | No payment from the shopper | Disclosed next to the link; only added after the retailer agrees in writing; no tracking beyond the retailer's own link parameters; consent if any cookie is set on our side |
| 4 | **Aggregated market insights** for brands | Sells statistics, not people | Only price and availability series already public on the site, aggregated; no shopper-derived data at all unless k >= 20 and counsel approves; contracts forbid re-identification |

Not considered: selling data about users, paid placement inside the price comparison, "pay to appear" for
retailers that would otherwise be covered, pop-up ads, or any third-party ad network (they would require
third-party scripts and tracking cookies, which conflicts with the consent model in `docs/legal/cookie-policy.md`).

## Required engineering before any paid placement exists

- A `sponsored` flag on any content type that can be paid for, enforced by the database (no default, cannot
  be null), rendered by one shared component that cannot omit the label.
- An E2E test that fails if any element marked sponsored lacks the visible label in EN and AR.
- Sponsored items excluded from `popular searches`, sitemap `product` URLs and JSON-LD `offers`.
- A kill switch per sponsor (same pattern as source kill switches) and an audit entry for every change.

## Legal review questions for counsel (add to `docs/legal/counsel-brief.md` when monetisation is live)

1. Qatari consumer-protection and advertising rules on endorsements, comparison and "cheapest" claims.
2. Whether a labelled sponsored slot is acceptable next to comparison results, and the wording required.
3. Competition-law position on retailers paying for promotion on a platform that compares their prices.
4. Whether retailer subscription revenue changes the company's licence or VAT position.
5. Contract terms for retailers who supply data (ownership, licence, warranty of accuracy, termination).

## Review cadence

Reviewed with counsel before the first paid feature, then every six months. Changes are recorded in the
plan's Change Log.
