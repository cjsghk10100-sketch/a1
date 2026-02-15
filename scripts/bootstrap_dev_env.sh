#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[bootstrap] installing dependencies"
pnpm i

echo "[bootstrap] starting postgres"
docker compose -f infra/docker-compose.yml up -d

echo "[bootstrap] running migrations"
pnpm db:migrate

echo "[bootstrap] done"
