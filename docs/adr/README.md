# Architecture Decision Records

The authoritative short log lives in `plan.txt` Section B (ADR-001..006). For decisions needing more
than a paragraph, add `NNNN-title.md` here using the template below and reference it from Section B.

```
# ADR-NNN: Title
Date / Status (proposed|accepted|superseded by ADR-xxx)
Context / Decision / Alternatives / Consequences
```

Open decisions to record: ORM/migrations tool (Prisma vs Drizzle vs Alembic), orchestrator
(Celery vs Prefect vs Dagster), Meilisearch vs OpenSearch, entity form (LLC vs QFC/QFZ/QSTP).
