# qarib-ingest (plan Phase 3)

Ingestion workers. **No source runs unless the Source Registry says `green` and the kill switch is
off** - enforced in `batch.assert_runnable`, again in SQL by `record_price()`, and the registry
itself can't hold a `green` automated source without a recorded approval (see
`docs/legal/data-collection-policy.md`).

```
adapter.fetch()  ->  raw artefacts stored immutably (90-day retention)
adapter.parse()  ->  RawOffer rows  (+ invalid rows -> dead_letters)
pipeline         ->  upsert listing (match_status='review'; matching is Phase 4)
                     -> outlier gate (>50% vs 30-day median => held_prices, not published)
                     -> record_price()  (history + current price + unit price)
```

| Module | Plan | Purpose |
| ------ | ---- | ------- |
| `fetcher.py` | 3.2 | identifying User-Agent, robots.txt (fail closed), per-domain + global rate limit, circuit breaker on 403/429/CAPTCHA |
| `adapters/feed.py` | 3.3 A | partner CSV / JSON feeds (file or URL) |
| `pipeline.py` | 3.1, 3.4, 3.6 | normalise, upsert, outlier hold, branch hint |
| `batch.py` | 3.1, 3.2 | gate -> fetch -> store -> parse -> publish; auto-disable on breaker trip |
| `store.py` | 3.1 | local dir (dev) or Azure Blob / Azurite |
| `maintenance.py` | 2.1, 0.9 | future partitions, artefact + dead-letter retention, privacy purges |

## Try it locally
```bash
pnpm up && pnpm db:migrate && pnpm seed          # from repo root
# approve a manual source in the registry first (example uses the seeded demo source):
docker compose exec postgres psql -U qarib -d qarib -c "select id from sources limit 1"
cd services/ingest && pip install -e ".[dev]"
qarib-ingest run-feed --source-id <UUID> --file examples/partner-feed.csv
qarib-ingest health
qarib-ingest maintenance        # run daily from a scheduler
```
Exit codes: `0` ok, `1` batch failed/aborted, `2` usage, `3` source refused (not approved / disabled).

## Not built yet (plan 3.3 B-E)
Flyer/PDF + OCR ingestion with a human-verification queue, crowd-sourced receipts, approved public-web
crawlers, and the field-team mobile form. `PoliteFetcher` is the prerequisite for the web crawlers;
there are deliberately **no** retailer-specific crawlers until a source is approved.
