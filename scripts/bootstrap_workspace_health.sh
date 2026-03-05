#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WORKSPACE_ID="ws_dev"
DRY_RUN=0
ENV_FILE="${ROOT_DIR}/.env.desktop"

usage() {
  cat <<'USAGE'
Usage: bootstrap_workspace_health.sh [--workspace ID] [--dry-run] [--env-file PATH]

Ensure system-health projection watermark seed for a workspace.
Behavior:
  - If projector_watermarks row does not exist, seed from evt_events MAX(occurred_at).
  - Existing row is left untouched.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      WORKSPACE_ID="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[bootstrap-health] unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[bootstrap-health] DATABASE_URL is required (env or ${ENV_FILE})" >&2
  exit 1
fi

PSQL_BIN="/opt/homebrew/opt/postgresql@16/bin/psql"
if [[ ! -x "${PSQL_BIN}" ]]; then
  PSQL_BIN="$(command -v psql || true)"
fi
if [[ -z "${PSQL_BIN}" || ! -x "${PSQL_BIN}" ]]; then
  echo "[bootstrap-health] psql executable not found" >&2
  exit 1
fi

query_state() {
  "${PSQL_BIN}" "${DATABASE_URL}" -v ON_ERROR_STOP=1 -v WORKSPACE_ID="${WORKSPACE_ID}" -At <<'SQL'
SELECT
  COALESCE((SELECT MAX(occurred_at)::text FROM evt_events WHERE workspace_id = :'WORKSPACE_ID'), ''),
  COALESCE((SELECT last_applied_event_occurred_at::text FROM projector_watermarks WHERE workspace_id = :'WORKSPACE_ID' LIMIT 1), '')
;
SQL
}

if [[ "${DRY_RUN}" -eq 1 ]]; then
  IFS='|' read -r latest_event_at current_watermark_at < <(query_state)
  would_insert="false"
  if [[ -n "${latest_event_at}" && -z "${current_watermark_at}" ]]; then
    would_insert="true"
  fi
  echo "[bootstrap-health] dry-run"
  echo "workspace_id=${WORKSPACE_ID}"
  echo "latest_event_at=${latest_event_at:-<none>}"
  echo "current_watermark_at=${current_watermark_at:-<none>}"
  echo "would_insert=${would_insert}"
  exit 0
fi

RESULT="$(
  "${PSQL_BIN}" "${DATABASE_URL}" -v ON_ERROR_STOP=1 -v WORKSPACE_ID="${WORKSPACE_ID}" -At <<'SQL'
WITH latest AS (
  SELECT MAX(occurred_at) AS latest_event_at
  FROM evt_events
  WHERE workspace_id = :'WORKSPACE_ID'
),
ins AS (
  INSERT INTO projector_watermarks (workspace_id, last_applied_event_occurred_at, updated_at)
  SELECT :'WORKSPACE_ID', latest_event_at, now()
  FROM latest
  WHERE latest_event_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM projector_watermarks
      WHERE workspace_id = :'WORKSPACE_ID'
    )
  ON CONFLICT (workspace_id) DO NOTHING
  RETURNING last_applied_event_occurred_at
)
SELECT
  COALESCE((SELECT COUNT(*)::int FROM ins), 0),
  COALESCE((SELECT latest_event_at::text FROM latest), ''),
  COALESCE(
    (SELECT last_applied_event_occurred_at::text FROM ins LIMIT 1),
    (
      SELECT last_applied_event_occurred_at::text
      FROM projector_watermarks
      WHERE workspace_id = :'WORKSPACE_ID'
      LIMIT 1
    ),
    ''
  )
;
SQL
)"

IFS='|' read -r inserted_count latest_event_at watermark_after <<<"${RESULT}"

echo "[bootstrap-health] workspace_id=${WORKSPACE_ID}"
echo "[bootstrap-health] inserted_count=${inserted_count}"
echo "[bootstrap-health] latest_event_at=${latest_event_at:-<none>}"
echo "[bootstrap-health] watermark_after=${watermark_after:-<none>}"
