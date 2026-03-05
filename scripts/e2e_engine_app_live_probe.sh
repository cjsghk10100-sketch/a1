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

API_PORT="${DESKTOP_API_PORT:-3000}"
WORKSPACE_ID="${DESKTOP_WORKSPACE_ID:-ws_dev}"
OWNER_PASSPHRASE="${DESKTOP_OWNER_PASSPHRASE:-}"
API_BASE="http://127.0.0.1:${API_PORT}"

if [[ -z "$OWNER_PASSPHRASE" ]]; then
  echo "[live-probe] DESKTOP_OWNER_PASSPHRASE is required (.env.desktop)" >&2
  exit 1
fi

tmp_body="$(mktemp)"
cleanup() {
  rm -f "$tmp_body"
}
trap cleanup EXIT

http_json_post() {
  local url="$1"
  local auth_header="$2"
  local workspace_header="$3"
  local payload="$4"

  local args=(-sS -o "$tmp_body" -w "%{http_code}" -X POST "$url" -H "content-type: application/json" -d "$payload")
  if [[ -n "$auth_header" ]]; then
    args+=(-H "authorization: Bearer ${auth_header}")
  fi
  if [[ -n "$workspace_header" ]]; then
    args+=(-H "x-workspace-id: ${workspace_header}")
  fi

  curl "${args[@]}"
}

echo "[live-probe] 1/4 /health"
health_code="$(curl -sS -o "$tmp_body" -w "%{http_code}" "${API_BASE}/health")"
if [[ "$health_code" != "200" ]]; then
  echo "[live-probe] /health failed: ${health_code}" >&2
  cat "$tmp_body" >&2
  exit 1
fi

echo "[live-probe] 2/4 login"
login_payload="$(jq -n --arg workspace_id "$WORKSPACE_ID" --arg passphrase "$OWNER_PASSPHRASE" '{workspace_id: $workspace_id, passphrase: $passphrase}')"
login_code="$(http_json_post "${API_BASE}/v1/auth/login" "" "" "$login_payload")"
if [[ "$login_code" != "200" ]]; then
  echo "[live-probe] login failed: ${login_code}" >&2
  cat "$tmp_body" >&2
  exit 1
fi
ACCESS_TOKEN="$(jq -r '.session.access_token // .access_token // empty' "$tmp_body")"
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "[live-probe] login returned empty access_token" >&2
  cat "$tmp_body" >&2
  exit 1
fi

echo "[live-probe] 3/4 /v1/system/health"
system_code="$(http_json_post "${API_BASE}/v1/system/health" "$ACCESS_TOKEN" "$WORKSPACE_ID" '{"schema_version":"2.1"}')"
if [[ "$system_code" != "200" ]]; then
  echo "[live-probe] system health failed: ${system_code}" >&2
  cat "$tmp_body" >&2
  exit 1
fi
if ! jq -e '.schema_version and .summary and .summary.health_summary' "$tmp_body" >/dev/null; then
  echo "[live-probe] system health response shape mismatch" >&2
  cat "$tmp_body" >&2
  exit 1
fi

echo "[live-probe] 4/4 /v1/finance/projection"
finance_code="$(http_json_post "${API_BASE}/v1/finance/projection" "$ACCESS_TOKEN" "$WORKSPACE_ID" '{"schema_version":"2.1","days_back":30,"include":["top_models"]}')"
if [[ "$finance_code" != "200" ]]; then
  echo "[live-probe] finance projection failed: ${finance_code}" >&2
  cat "$tmp_body" >&2
  exit 1
fi
if ! jq -e '.schema_version and (.warnings | type=="array") and (.series_daily | type=="array")' "$tmp_body" >/dev/null; then
  echo "[live-probe] finance projection response shape mismatch" >&2
  cat "$tmp_body" >&2
  exit 1
fi

echo "[live-probe] PASS (${WORKSPACE_ID})"
