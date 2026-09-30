# Soft launch (beta) runbook (plan 10.6)

The beta is a real, public-but-quiet release to a small invited group. It exists to find the problems that
tests cannot: wrong data, confusing wording, a retailer objecting. It runs on the production stack, with
real (approved) sources only, behind an invite gate, for **four weeks**.

**Precondition:** every "blocking for beta" item in `docs/legal/launch-checklist.md` is ticked. If it is not,
the beta does not start; the beta is not a way to skip legal work.

## 1. Before day 0

- [ ] Stack deployed with `docs/runbooks/deploy.md` (dev -> staging -> prod), canary green
- [ ] At least **three** retailers live, each `green` in the Source Registry with its `approval.md`
- [ ] Data-accuracy audit (`qarib-ingest qa-audit`, template in `services/ingest/examples/`) run by the
      field team on >= 300 items across >= 3 retailers: accuracy >= 95 %, report committed to `docs/qa/`
- [ ] Restore drill done (`docs/runbooks/disaster-recovery.md`), result recorded
- [ ] Alerts wired to a human phone; on-call rota for the four weeks published
- [ ] Takedown inbox, breach contacts and support inbox all tested with a message
- [ ] `site_indexing = "off"` in the environment's tfvars (web gets `SITE_INDEXING=off`): robots.txt becomes
      `Disallow: /`, the sitemap is empty and every page carries `X-Robots-Tag: noindex, nofollow`.
      Verify: `curl -s https://<host>/robots.txt` and `curl -sI https://<host>/en | grep -i x-robots`.
      This keeps the site out of search engines; it does **not** stop anyone who has the link.
- [ ] If the beta must be *unreachable* to outsiders (not just unindexed), add an Application Gateway WAF
      custom rule allowing only the invitees' networks. That is a manual step today (no Terraform variable
      yet); record it in the change log when done. The site has no login wall by design: prices are public.
- [ ] Kill-switch drill performed on staging within the last 7 days

## 2. Invited group

50-100 people: staff, friends, the usability-test participants, a few community moderators. Invitation text
says plainly: prices are in testing; report anything that looks wrong; here is how your data is handled;
you can leave and have everything deleted at any time.

## 3. Timeline

| Day | Action |
|---|---|
| 0 | Open to the invite group. Daily 15-minute stand-up on the dashboard below. |
| 1-7 | Fix S1 issues same day. Field team spot-checks 30 prices/day. Every user report triaged < 24 h. |
| 7 | Decision checkpoint 1: accuracy >= 95 %, no open S1, no retailer objection -> continue. Otherwise extend by a week, never skip. |
| 14 | Set `site_indexing = "on"` and redeploy the web app config (no rebuild needed). Announce to two community channels. |
| 21 | Load check against real traffic; review cost vs budget; second accuracy audit. |
| 28 | Go/no-go meeting (section 5). |

## 4. What to watch (daily)

| Signal | Source | Threshold -> action |
|---|---|---|
| Source freshness | admin console "Source health" | any source > 36 h stale -> investigate; > 72 h -> hide its offers |
| Price reports per day, % accepted | admin "Community price reports" | > 5 % of views produce a report -> a source is wrong; pause it |
| Matcher review queue depth | admin "Candidates" (match review) | > 200 -> assign a reviewer |
| Error rate / p95 latency | Log Analytics alerts | alert fires -> `docs/runbooks/operations.md` |
| Search with zero results | `popular_searches` (k >= 20 only) | top zero-result terms -> add synonyms or sources |
| Takedown / complaint requests | admin "Takedowns & complaints" | answer < 2 business days, always a human |
| Consent opt-in rate | aggregate only | sanity check only; never pressure users |

## 5. Go / no-go (day 28)

Public launch proceeds only if **all** are true; otherwise extend the beta and record why in the plan's
Change Log.

- [ ] Data accuracy >= 95 % in the latest audit (and >= 95 % in each retailer)
- [ ] No open S1 or S2 usability or bug items
- [ ] No unresolved takedown or retailer complaint
- [ ] Availability >= 99.5 % across the four weeks; no data-loss incident
- [ ] No personal-data incident (or each one handled per `breach-response.md`, with counsel's view on notification)
- [ ] Independent penetration test: no open High/Critical
- [ ] Legal go-live gate fully ticked (`docs/legal/launch-checklist.md`), counsel sign-off recorded
- [ ] Cost run-rate within budget, with a plan for the launch traffic

## 6. Stopping the beta

Any of: a credible legal complaint, a personal-data incident with real exposure, a source's rights holder
objecting, or accuracy < 90 %. Steps: kill-switch the affected source(s) (`operations.md`); to stop
everything, kill-switch **all** sources (the site stays up but shows no prices, which is safe and reversible),
tell the affected people, and write the incident up before reopening. There is no separate maintenance mode.
