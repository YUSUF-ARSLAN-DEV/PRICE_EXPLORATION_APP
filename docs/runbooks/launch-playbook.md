# Public launch playbook (plan 11.1, 11.2, 11.3)

Use after the soft launch's day-28 go/no-go (`soft-launch.md` section 5) and the legal gate
(`docs/legal/launch-checklist.md`) are both complete. If either is not, this playbook does not start.

## 1. Launch readiness (T-7 days)

- [ ] Go/no-go recorded in `plan.txt` Change Log ("Legal go-live approval", signed by counsel)
- [ ] `site_indexing = "on"` planned for the launch day; sitemap checked with Search Console
- [ ] Methodology page (`/about`) current: sources, how often prices update, how matching works, what
      "cheapest" means, how to report an error. Dated.
- [ ] Support inbox staffed (section 4); macros in Arabic and English written and reviewed
- [ ] On-call rota for launch week, with a named incident lead and a named legal contact
- [ ] Capacity: `web` and `api` min replicas raised for launch week; cost alert thresholds checked
- [ ] Rollback rehearsed: previous image tag recorded, canary script (`scripts/deploy/canary.sh`) dry-run
- [ ] Status page or pinned post ready, in case of an outage

## 2. Announcement rules

- Say what the product is: a price comparison for the stores we cover, with the date prices were updated.
- **No unsubstantiated superlatives.** "Cheapest in Qatar" is prohibited. "Compare milk across 4 stores" is fine.
- No claims about savings unless computed from a documented basket on a stated date; link the method.
- Retailers are named only where they have agreed or where their prices are lawfully public and we say so.
- Channels: Qatar community forums and groups, LinkedIn, Instagram, WhatsApp shares, local press and consumer
  channels. Post from company accounts only. Do not scrape groups for contacts; do not message people who
  have not asked to hear from us.
- Any influencer or paid promotion must be disclosed as such by the poster.

## 3. Launch day and week

| When | Do |
|---|---|
| T-0 morning | Flip `site_indexing` to `on`; confirm `robots.txt`; post announcement; staff watch dashboards |
| Hourly (first day) | Error rate, p95 latency, source freshness, support inbox, takedown inbox |
| T+1 | Review first-day reports; fix S1 immediately; publish known issues if any |
| T+3 | Accuracy audit on 100 items (`qarib-ingest qa-audit`); compare with beta figure |
| T+7 | Launch retrospective: what broke, what confused people, what retailers said; update plan and risk register |

## 4. Operations rhythm (plan 11.2; details in `operations.md`)

| Cadence | Activity |
|---|---|
| **Daily** | Source health and freshness; takedown inbox (acknowledge < 1 business day, resolve < 2); match review queue; held prices; support inbox; alerts |
| **Weekly** | Accuracy audit (30 prices minimum, written result); release; cost review; legal-source review (any source status or terms changed?); retailer claims queue |
| **Monthly** | Retention verification (receipts, search log, tokens, claims) via maintenance job output; access review (who is admin?); dependency updates; privacy request statistics |
| **Quarterly** | Restore test (`disaster-recovery.md`); kill-switch drill; tabletop of breach response |
| **Annual** | Penetration test; DPIA and ROPA refresh; policy review with counsel; DR exercise; usability study |

## 5. Support and SLA (plan 11.3)

| Channel | First response | Resolution target |
|---|---|---|
| Support e-mail (AR/EN) | 2 business days | 5 business days |
| Privacy request (export, erase, correction) | acknowledge within 2 business days; complete within **30 days** | self-service export/erase is instant; manual cases 30 days |
| Takedown / complaint | acknowledge 1 business day | resolve 2 business days |
| Retailer claim | 3 business days | depends on verification |
| Security report (`/.well-known/security.txt`) | 2 business days | severity-based; credit reporters who follow the policy |

Rules: reply in the writer's language; never ask for a password or full card number; never put personal
data in public tickets; escalate anything legal (complaint from a regulator, a retailer's lawyer, a
possible breach) to the legal contact the same day.

Macros to write before launch (Arabic and English): acknowledge, price looks wrong, how to delete my
account, how to export, not a bug (price differs by branch), retailer contact, takedown received, claim
received, security report received.

## 6. Incident communication

Follow `breach-response.md` for anything touching personal data. For outages: status post within 30 minutes
of detection, updates hourly, a short written post-mortem within 5 business days (what happened, impact,
cause, fix, what changes).

## 7. Metrics reviewed monthly (plan 1.4)

Active searchers, searches per visitor, share of searches with at least two stores, zero-result rate, price
freshness (median age), accuracy audit result, takedown count and time to resolve, consent opt-in rate
(observed, never optimised), cost per thousand searches.
