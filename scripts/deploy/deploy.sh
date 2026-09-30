#!/usr/bin/env bash
# Roll out one release to one environment (plan 9.4).
#   deploy.sh <env: dev|staging|prod> <image-tag>
# Order: migrate (expand-only, backward compatible) -> jobs -> API canary -> web canary -> admin -> smoke.
# Needs an `az login` session (GitHub OIDC in CI) with rights on the resource group.
# NOT exercised against a real Azure subscription here; dry-run in DEV before relying on it.
set -euo pipefail

ENVIRONMENT=${1:?environment}
TAG=${2:?image tag}
HERE=$(cd "$(dirname "$0")" && pwd)
RG="rg-qarib-${ENVIRONMENT}"
NAME="qarib-${ENVIRONMENT}"
SUFFIX=$(echo "$TAG" | tr -c 'a-z0-9-' '-' | cut -c1-20 | sed 's/-*$//')
[ -n "$SUFFIX" ] || SUFFIX=rel

log() { printf '%s [deploy %s] %s\n' "$(date -u +%FT%TZ)" "$ENVIRONMENT" "$*"; }

ACR=$(az acr list -g "$RG" --query "[0].loginServer" -o tsv)
WORKSPACE=$(az monitor log-analytics workspace show -g "$RG" -n "log-${NAME}" --query customerId -o tsv)
if [ -z "$ACR" ] || [ -z "$WORKSPACE" ]; then log "resource group $RG is not provisioned"; exit 2; fi
log "release $TAG, registry $ACR"

# ---- 1. migrations (the DB must already be compatible with BOTH the old and the new code) ----
MIGRATE="caj-${NAME}-migrate"
az containerapp job update -g "$RG" -n "$MIGRATE" --image "$ACR/qarib-api:$TAG" >/dev/null
EXEC=$(az containerapp job start -g "$RG" -n "$MIGRATE" --query name -o tsv)
log "migration execution $EXEC started"
for _ in $(seq 1 60); do
  status=$(az containerapp job execution show -g "$RG" -n "$MIGRATE" --job-execution-name "$EXEC" --query properties.status -o tsv 2>/dev/null || echo Unknown)
  case "$status" in
    Succeeded) log "migrations applied"; break ;;
    Failed|Stopped|Degraded) log "MIGRATION FAILED ($status): not deploying. Logs: az containerapp job logs show"; exit 1 ;;
  esac
  sleep 10
done
[ "${status:-}" = "Succeeded" ] || { log "migration timed out"; exit 1; }

# ---- 2. scheduled jobs pick up the new images on their next run ----
for job in alerts maintenance-api reindex freshness; do
  az containerapp job update -g "$RG" -n "caj-${NAME}-${job}" --image "$ACR/qarib-api:$TAG" >/dev/null
done
az containerapp job update -g "$RG" -n "caj-${NAME}-maintenance-ingest" --image "$ACR/qarib-ingest:$TAG" >/dev/null
az containerapp job update -g "$RG" -n "caj-${NAME}-matcher" --image "$ACR/qarib-matcher:$TAG" >/dev/null
log "jobs updated"

# ---- 3. canaries: API first (web proxies to it), then web ----
"$HERE/canary.sh" "$RG" "ca-${NAME}-api" "$ACR/qarib-api:$TAG" "$SUFFIX" "$WORKSPACE"
"$HERE/canary.sh" "$RG" "ca-${NAME}-web" "$ACR/qarib-web:$TAG" "$SUFFIX" "$WORKSPACE"

# ---- 4. admin console (internal tool, single revision) ----
az containerapp update -g "$RG" -n "ca-${NAME}-admin" --image "$ACR/qarib-admin:$TAG" >/dev/null
log "admin updated"

# ---- 5. reindex search and smoke test ----
az containerapp job start -g "$RG" -n "caj-${NAME}-reindex" >/dev/null || true
if [ -n "${PUBLIC_URL:-}" ]; then
  log "smoke test against $PUBLIC_URL"
  node "$HERE/../smoke-stack.mjs" "$PUBLIC_URL" "${ADMIN_URL:-$PUBLIC_URL}"
fi
log "release $TAG deployed"
