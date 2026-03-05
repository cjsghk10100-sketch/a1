#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_PATH="${SCRIPT_DIR}/templates/com.agentapp.api.plist.template"

LABEL="com.agentapp.api"
REPO_ROOT="/Users/min/agentapp"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: install_api_launchagent.sh [--repo-root PATH] [--label NAME] [--dry-run]

Install and reload LaunchAgent for local API runtime.
Defaults:
  repo root: /Users/min/agentapp
  label:     com.agentapp.api
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="${2:-}"
      shift 2
      ;;
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[install-launchagent] unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "${TEMPLATE_PATH}" ]]; then
  echo "[install-launchagent] missing template: ${TEMPLATE_PATH}" >&2
  exit 1
fi

if [[ ! -d "${REPO_ROOT}" ]]; then
  echo "[install-launchagent] repo root not found: ${REPO_ROOT}" >&2
  exit 1
fi

PNPM_BIN="/opt/homebrew/bin/pnpm"
if [[ ! -x "${PNPM_BIN}" ]]; then
  PNPM_BIN="$(command -v pnpm || true)"
fi
if [[ -z "${PNPM_BIN}" || ! -x "${PNPM_BIN}" ]]; then
  echo "[install-launchagent] pnpm executable not found" >&2
  exit 1
fi

PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
STDOUT_PATH="${HOME}/Library/Logs/agentapp-api.out.log"
STDERR_PATH="${HOME}/Library/Logs/agentapp-api.err.log"

xml_escape() {
  local v="$1"
  v="${v//&/&amp;}"
  v="${v//</&lt;}"
  v="${v//>/&gt;}"
  printf '%s' "${v}"
}

sed_escape() {
  printf '%s' "$1" | sed -e 's/[&|]/\\&/g'
}

COMMAND_RAW="set -euo pipefail; export CRON_HEART_ENABLED=1; if [ -x /opt/homebrew/bin/brew ]; then eval \"\$(/opt/homebrew/bin/brew shellenv)\" >/dev/null 2>/dev/null || true; fi; cd ${REPO_ROOT}; set -a; if [ -f ./.env.desktop ]; then source ./.env.desktop; fi; set +a; exec ${PNPM_BIN} -C apps/api start"

LABEL_ESCAPED="$(sed_escape "$(xml_escape "${LABEL}")")"
WORKING_DIR_ESCAPED="$(sed_escape "$(xml_escape "${REPO_ROOT}")")"
STDOUT_ESCAPED="$(sed_escape "$(xml_escape "${STDOUT_PATH}")")"
STDERR_ESCAPED="$(sed_escape "$(xml_escape "${STDERR_PATH}")")"
COMMAND_ESCAPED="$(sed_escape "$(xml_escape "${COMMAND_RAW}")")"

TMP_PLIST="$(mktemp)"
sed \
  -e "s|__LABEL__|${LABEL_ESCAPED}|g" \
  -e "s|__WORKING_DIRECTORY__|${WORKING_DIR_ESCAPED}|g" \
  -e "s|__STDOUT_PATH__|${STDOUT_ESCAPED}|g" \
  -e "s|__STDERR_PATH__|${STDERR_ESCAPED}|g" \
  -e "s|__COMMAND__|${COMMAND_ESCAPED}|g" \
  "${TEMPLATE_PATH}" > "${TMP_PLIST}"

plutil -lint "${TMP_PLIST}" >/dev/null

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "[install-launchagent] dry-run mode"
  echo "label=${LABEL}"
  echo "repo_root=${REPO_ROOT}"
  echo "pnpm_bin=${PNPM_BIN}"
  echo "plist_path=${PLIST_PATH}"
  echo "command=${COMMAND_RAW}"
  rm -f "${TMP_PLIST}"
  exit 0
fi

mkdir -p "$(dirname "${PLIST_PATH}")" "$(dirname "${STDOUT_PATH}")"
cp "${TMP_PLIST}" "${PLIST_PATH}"
rm -f "${TMP_PLIST}"

UID_VALUE="$(id -u)"
launchctl bootout "gui/${UID_VALUE}" "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_VALUE}" "${PLIST_PATH}"
launchctl kickstart -k "gui/${UID_VALUE}/${LABEL}"

echo "[install-launchagent] installed: ${PLIST_PATH}"
launchctl print "gui/${UID_VALUE}/${LABEL}" | sed -n '1,60p'
