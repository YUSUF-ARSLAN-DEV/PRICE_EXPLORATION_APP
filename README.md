# Qarib - Qatar grocery price comparison

Search a grocery item, see its price at every Qatari grocer we legally cover.
**The source of truth is [`plan.txt`](plan.txt).** If you deviate from it, add a Change Log entry in
the same PR.

## Quick start (target: < 15 minutes)

Prerequisites: Node >= 20, pnpm 9 (`corepack enable` or `npm i -g pnpm@9`), Docker Desktop,
Python >= 3.12.

```bash
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
pnpm install
pnpm up                         # postgres, redis, meilisearch, azurite (Blob), mailpit
pnpm build && pnpm test         # sanity check
pnpm dev                        # web :3000, admin :3001, api :4000
```

Python services:

```bash
cd services/ingest && python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]" && ruff check . && mypy src && pytest
```

| Command      | What it does                        |
| ------------ | ----------------------------------- |
| `pnpm up`    | start local infrastructure          |
| `pnpm down`  | stop it                             |
| `pnpm reset` | wipe volumes and restart            |
| `pnpm lint` / `typecheck` / `test` / `build` | via Turborepo |

Local services: Postgres 5432, Redis 6379, Meilisearch 7700, Azurite Blob 10000, Mailpit UI 8025.

## Layout
`apps/web` (Next.js) - `apps/api` (NestJS, `GET /health`) - `apps/admin` (internal) -
`services/ingest`, `services/matcher` (Python) - `packages/shared` (TS types/zod) -
`infra/` (docker, terraform) - `docs/` (legal, security, architecture, runbooks, adr).

## Rules that matter
1. Never commit secrets, personal data, or scraped third-party content.
2. No automated data collection from any site unless its Source Registry row is `green`
   (`docs/legal/data-collection-policy.md`).
3. Conventional Commits. PRs must tick the plan-deviation box.
4. Legal documents in `docs/legal/` are drafts until counsel approves them.
