# QA toolbox (plan 10)

Everything below runs against the local production-image stack:

```bash
docker compose -f docker-compose.stack.yml up -d --wait     # demo data, Mailpit, Meilisearch
pnpm --filter @qarib/e2e install:browsers                   # once
pnpm --filter @qarib/e2e test:e2e                               # browser tests (EN/AR, desktop + Pixel 5), axe, chaos
pnpm --filter @qarib/e2e lighthouse                         # budgets: perf >= 90, a11y/SEO/best-practices >= 95
docker compose -f docker-compose.stack.yml exec -T db psql -U qarib -d qarib -v ON_ERROR_STOP=1 < load/seed-large.sql
docker compose -f docker-compose.stack.yml exec -T api node dist/jobs/run.js reindex
docker run --rm -i --network host -e API=http://localhost:4000 -e WEB=http://localhost:3000 grafana/k6 run - < load/api.js
```

| What | Where | Notes |
|---|---|---|
| Browser tests | `e2e/tests/*.spec.ts` | Run on **one worker**: the admin kill-switch and chaos specs change shared state. Chaos stops and restarts real containers. |
| Accessibility (automated) | `e2e/tests/a11y.spec.ts` | axe, WCAG 2.2 AA; serious/critical fail the build. Automated checks cover roughly a third of problems. |
| Usability (manual) | `usability-test-plan.md` | Plan only; no sessions run yet. |
| Load | `load/api.js`, `load/seed-large.sql` | The seed is synthetic and flagged demo. Numbers come from one developer machine, not Azure SKUs. |
| Data accuracy | `qarib-ingest qa-audit` | Field team fills `services/ingest/examples/qa-audit-template.csv`; gate: >= 95 % over >= 300 rows, >= 3 retailers. |
| Soft launch | `../runbooks/soft-launch.md` | |

Local environment note: the load test and the chaos specs need Docker; the k6 image is pulled on first use.
