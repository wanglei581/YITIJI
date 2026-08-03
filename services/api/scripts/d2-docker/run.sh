#!/usr/bin/env bash
# F1 Genesis D2 — Docker (or Colima) isolation plane.
# Does NOT touch production host PM2 / /srv / secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
API_DIR="$ROOT/services/api"
IMAGE="${D2_DOCKER_IMAGE:-node:22-bookworm-slim}"
EVIDENCE_DIR="${D2_EVIDENCE_DIR:-$API_DIR/scripts/d2-docker/.evidence}"
mkdir -p "$EVIDENCE_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "D2_DOCKER_MISSING: docker client not found" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "D2_DOCKER_DAEMON_DOWN: start Colima/Docker Desktop first" >&2
  exit 2
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$EVIDENCE_DIR/d2-evidence-$STAMP.json"

echo "D2_PLANE=docker-isolation"
echo "D2_IMAGE=$IMAGE"
echo "D2_EVIDENCE=$OUT"

docker run --rm \
  --name "f1-d2-drill-$STAMP" \
  -e D2_DRILL_PLANE=docker-isolation \
  -e HOME=/root \
  -e PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  -e D2_ENV_CANARY="host-should-not-leak" \
  -v "$API_DIR:/work/services/api:ro" \
  -w /work/services/api \
  "$IMAGE" \
  bash -lc '
    set -euo pipefail
    apt-get update -qq >/dev/null
    apt-get install -y -qq ca-certificates >/dev/null
    npm install -g pm2@6 >/dev/null 2>&1
    node --version
    pm2 -v
    node scripts/d2-docker-drill.mjs
  ' | tee "$OUT"

echo "D2_DONE evidence=$OUT"
