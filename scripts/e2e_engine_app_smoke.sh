#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ./.env.desktop ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env.desktop
  set +a
fi

echo "[smoke] 1/4 engine ingest tests"
pnpm -C apps/engine test:ingest

echo "[smoke] 2/4 api contract_engine_evidence_ingest"
pnpm -C apps/api exec tsx test/contract_engine_evidence_ingest.ts

echo "[smoke] 3/4 ops-dashboard typecheck"
pnpm -C apps/ops-dashboard typecheck

echo "[smoke] 4/4 ops-dashboard tests"
pnpm -C apps/ops-dashboard test

echo "[smoke] PASS"
