# Brief for Qatari counsel (plan step 0.1)

**Project:** a website/PWA where consumers search a grocery item and see its price across Qatari
grocers (supermarkets, hypermarkets, delivery marketplaces). Arabic + English. Operator: a company
(`[COMPANY NAME]`), hosted on Microsoft Azure in the Qatar Central region, domain `[DOMAIN.qa]`.
Full technical plan: `plan.txt`.

**What we need:** a written opinion on the questions below, and review/redlining of the drafts in
`/docs/legal/`.

## A. Corporate / licensing
1. Best entity form (LLC via MoCI vs QFC / Qatar Free Zones / QSTP) for an online price-comparison
   service with foreign and/or Qatari shareholders. Foreign-ownership limits?
2. Trade-licence activity wording needed for: information/comparison platform, advertising,
   affiliate commissions. Any MoCI e-commerce platform registration or licence?
3. `.qa` domain registration requirements (company documents, trade-name match).

## B. Personal data (Law No. 13 of 2016 - PDPPL) and regulator guidance
4. Confirm obligations: lawful basis/consent, notice, data-subject rights and response periods,
   security, breach notification (to NCGAA and individuals - exact timing), record-keeping,
   any registration/DPIA duty, need for a DPO or named privacy lead.
5. Cross-border transfers: using Azure (Microsoft is a foreign processor even with in-country
   region; Entra ID/Front Door/support access may involve processing outside Qatar). Are DPAs
   + safeguards sufficient? Any NCSA cloud-policy restrictions for our data classification?
6. Email/SMS/WhatsApp marketing and price-alert consent rules (CRA / consumer rules).
7. Cookie/analytics consent expectations in Qatar (no explicit cookie law known - confirm).
8. Minimum age / parental consent handling.
9. Shopping baskets and search history: are these "special nature" data by inference? Our default
   is minimal storage, 90-day rolling retention, user can disable.

## C. Collecting and displaying prices (highest risk)
10. Is collecting publicly displayed prices (facts) from retailer websites by automated means
    lawful under the Cybercrime Law (Law 14/2014), copyright (Law 7/2002) and contract (site
    terms)? Under what conditions (robots.txt, rate limits, identified bot, no login)?
11. Is extracting prices from publicly distributed flyers (PDF/images) acceptable? Do we need
    licences for logos, product names, images?
12. Crowd-sourced shelf/receipt photos: licence, liability, PII handling.
13. Competition Law (Law 19/2006): risk that cross-retailer price transparency/history is
    treated as facilitating collusion? Should historical prices be delayed?
14. Consumer Protection Law (Law 8/2008) and advertising rules: disclaimers for stale/third-party
    prices; "cheapest" claims; Arabic-language requirements; sponsored placement labelling.
15. Use of retailer names/trademarks nominatively; comparative-advertising rules.

## D. Content restrictions
16. Alcohol, pork, tobacco/vapes: may we list/display prices? (Default in our plan: exclude
    alcohol and tobacco entirely; pork to be decided.) Tobacco control law promotion limits.
17. User-generated content moderation duties (defamation, false news, public morals).

## E. Documents to review
Terms of Use, Privacy Notice (EN/AR), Consent texts, Cookie policy, Takedown policy, Content
rules, DPIA, ROPA, sub-processor register, breach runbook, retention schedule, data-collection
policy, source registry template.

## Deliverables requested
- Opinion memo (store in `/docs/legal/opinion/`, not committed if privileged - see note below).
- Redlined AR + EN documents.
- A go/no-go view on each candidate data source (RED/AMBER/GREEN).

> Note: lawyer opinions are usually privileged. Do **not** commit them to a public repo; store in
> the company's private document system and record only the conclusions in the Change Log.
