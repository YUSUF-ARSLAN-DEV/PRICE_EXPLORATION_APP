#!/usr/bin/env bash
# Canary rollout of ONE Container App (plan 9.4): new revision gets 10 % of traffic for a bake
# period; if its server-error rate breaches the threshold the rollout is rolled back automatically,
# otherwise it is promoted to 100 % and the old revision is deactivated.
#
#   canary.sh <resource-group> <app-name> <image> <revision-suffix> <log-analytics-workspace-id>
#
# Env (optional): CANARY_PERCENT=10 CANARY_MINUTES=10 MAX_ERROR_RATE=0.02 MIN_REQUESTS=20
# NOT exercised against a real Azure subscription in this repository's tests (no subscription was
# available); review with `shellcheck` (CI does) and dry-run in DEV first.
set -euo pipefail

RG=${1:?resource group}
APP=${2:?container app name}
IMAGE=${3:?image}
SUFFIX=${4:?revision suffix (letters/digits/-)}
WORKSPACE=${5:?log analytics workspace customer id}
PERCENT=${CANARY_PERCENT:-10}
MINUTES=${CANARY_MINUTES:-10}
MAX_ERROR_RATE=${MAX_ERROR_RATE:-0.02}
MIN_REQUESTS=${MIN_REQUESTS:-20}

log() { printf '%s [canary %s] %s\n' "$(date -u +%FT%TZ)" "$APP" "$*"; }

OLD=$(az containerapp revision list -g "$RG" -n "$APP" \
  --query "[?properties.active && properties.trafficWeight > \`0\`] | sort_by(@, &properties.createdTime) | [-1].name" -o tsv)
if [ -z "$OLD" ]; then
  log "no active revision with traffic: first deployment, updating in place"
  az containerapp update -g "$RG" -n "$APP" --image "$IMAGE" --revision-suffix "$SUFFIX" >/dev/null
  exit 0
fi
log "current revision: $OLD"

# Pin 100 % to the current revision so the new one starts with 0 %.
az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$OLD=100" >/dev/null
az containerapp update -g "$RG" -n "$APP" --image "$IMAGE" --revision-suffix "$SUFFIX" >/dev/null
NEW="$APP--$SUFFIX"
log "new revision: $NEW - waiting for it to become healthy"

for i in $(seq 1 30); do
  state=$(az containerapp revision show -g "$RG" -n "$APP" --revision "$NEW" --query "properties.healthState" -o tsv 2>/dev/null || echo Unknown)
  [ "$state" = "Healthy" ] && break
  if [ "$i" = 30 ]; then
    log "new revision never became healthy (state=$state): aborting, traffic stays on $OLD"
    az containerapp revision deactivate -g "$RG" -n "$APP" --revision "$NEW" >/dev/null || true
    exit 1
  fi
  sleep 10
done

rollback() {
  log "ROLLBACK: $1"
  az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$OLD=100" >/dev/null
  az containerapp revision deactivate -g "$RG" -n "$APP" --revision "$NEW" >/dev/null || true
  exit 1
}

az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$OLD=$((100 - PERCENT))" "$NEW=$PERCENT" >/dev/null
log "canary at ${PERCENT}% for ${MINUTES} min (max error rate ${MAX_ERROR_RATE}, min ${MIN_REQUESTS} requests)"

QUERY="ContainerAppConsoleLogs_CL
| where RevisionName_s == '$NEW' and Log_s has '\"method\"' and Log_s has '\"status\"'
| summarize total = count(), errors = countif(Log_s has '\"status\":5')"

for minute in $(seq 1 "$MINUTES"); do
  sleep 60
  row=$(az monitor log-analytics query -w "$WORKSPACE" --analytics-query "$QUERY" --query "[0].[total, errors]" -o tsv 2>/dev/null || echo "")
  total=$(echo "$row" | cut -f1)
  errors=$(echo "$row" | cut -f2)
  total=${total:-0}
  errors=${errors:-0}
  log "minute $minute: $errors errors / $total requests"
  if [ "$total" -ge "$MIN_REQUESTS" ] && awk -v e="$errors" -v t="$total" -v m="$MAX_ERROR_RATE" 'BEGIN { exit !(e / t > m) }'; then
    rollback "error rate $errors/$total exceeds $MAX_ERROR_RATE"
  fi
done

az containerapp ingress traffic set -g "$RG" -n "$APP" --revision-weight "$NEW=100" >/dev/null
az containerapp revision deactivate -g "$RG" -n "$APP" --revision "$OLD" >/dev/null || true
log "promoted $NEW to 100 %, deactivated $OLD"
