-- Runs once on first container start (plan 1.4). Extensions needed by plan phases 2/4/5.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector (embeddings, Phase 4)
CREATE EXTENSION IF NOT EXISTS unaccent;
