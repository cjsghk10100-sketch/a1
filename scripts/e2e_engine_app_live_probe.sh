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

TMP_FILES=()
register_tmp() {
  TMP_FILES+=("$1")
}

tmp_body="$(mktemp)"
register_tmp "$tmp_body"
cleanup() {
  rm -f "${TMP_FILES[@]}"
}
trap cleanup EXIT

escape_curl_config_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

http_json_post() {
  local url="$1"
  local auth_header="$2"
  local workspace_header="$3"
  local payload_file="$4"
  local curl_cfg
  local escaped_url
  local escaped_payload
  local escaped_auth
  local escaped_workspace
  local http_code

  curl_cfg="$(mktemp)"
  register_tmp "$curl_cfg"
  escaped_url="$(escape_curl_config_value "$url")"
  escaped_payload="$(escape_curl_config_value "$payload_file")"
  {
    printf 'url = "%s"\n' "$escaped_url"
    printf 'request = "POST"\n'
    printf 'silent\n'
    printf 'show-error\n'
    printf 'output = "%s"\n' "$tmp_body"
    printf 'write-out = "%%{http_code}"\n'
    printf 'header = "content-type: application/json"\n'
    if [[ -n "$auth_header" ]]; then
      escaped_auth="$(escape_curl_config_value "authorization: Bearer ${auth_header}")"
      printf 'header = "%s"\n' "$escaped_auth"
    fi
    if [[ -n "$workspace_header" ]]; then
      escaped_workspace="$(escape_curl_config_value "x-workspace-id: ${workspace_header}")"
      printf 'header = "%s"\n' "$escaped_workspace"
    fi
    printf 'data-binary = "@%s"\n' "$escaped_payload"
  } >"$curl_cfg"

  http_code="$(curl --config "$curl_cfg")"
  printf '%s' "$http_code"
}

echo "[live-probe] 1/4 /health"
health_code="$(curl -sS -o "$tmp_body" -w "%{http_code}" "${API_BASE}/health")"
if [[ "$health_code" != "200" ]]; then
  echo "[live-probe] /health failed: ${health_code}" >&2
  cat "$tmp_body" >&2
  exit 1
fi

echo "[live-probe] 2/4 login"
tmp_login_payload="$(mktemp)"
register_tmp "$tmp_login_payload"
jq -n --arg workspace_id "$WORKSPACE_ID" --arg passphrase "$OWNER_PASSPHRASE" \
  '{workspace_id: $workspace_id, passphrase: $passphrase}' >"$tmp_login_payload"
login_code="$(http_json_post "${API_BASE}/v1/auth/login" "" "" "$tmp_login_payload")"
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
tmp_system_payload="$(mktemp)"
register_tmp "$tmp_system_payload"
printf '%s' '{"schema_version":"2.1"}' >"$tmp_system_payload"
system_code="$(http_json_post "${API_BASE}/v1/system/health" "$ACCESS_TOKEN" "$WORKSPACE_ID" "$tmp_system_payload")"
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
tmp_finance_payload="$(mktemp)"
register_tmp "$tmp_finance_payload"
printf '%s' '{"schema_version":"2.1","days_back":30,"include":["top_models"]}' >"$tmp_finance_payload"
finance_code="$(http_json_post "${API_BASE}/v1/finance/projection" "$ACCESS_TOKEN" "$WORKSPACE_ID" "$tmp_finance_payload")"
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
