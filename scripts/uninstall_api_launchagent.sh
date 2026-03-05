#!/usr/bin/env bash
set -euo pipefail

LABEL="com.agentapp.api"
REMOVE_FILE=0

usage() {
  cat <<'USAGE'
Usage: uninstall_api_launchagent.sh [--label NAME] [--remove-file]

Unload LaunchAgent for local API runtime.
Defaults:
  label: com.agentapp.api
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    --remove-file)
      REMOVE_FILE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[uninstall-launchagent] unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_VALUE="$(id -u)"

if [[ -f "${PLIST_PATH}" ]]; then
  launchctl bootout "gui/${UID_VALUE}" "${PLIST_PATH}" >/dev/null 2>&1 || true
else
  launchctl bootout "gui/${UID_VALUE}/${LABEL}" >/dev/null 2>&1 || true
fi

if [[ "${REMOVE_FILE}" -eq 1 && -f "${PLIST_PATH}" ]]; then
  rm -f "${PLIST_PATH}"
  echo "[uninstall-launchagent] removed plist: ${PLIST_PATH}"
else
  echo "[uninstall-launchagent] unloaded label: ${LABEL}"
fi
