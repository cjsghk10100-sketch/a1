#!/usr/bin/env bash
set -euo pipefail
ROOT="/Users/min/.openclaw/workspaces/seogi"
cd "$ROOT"
python3 scripts/promotion_dashboard_sync.py >/dev/null || true
python3 scripts/promotion_tmp_index.py >/dev/null || true
PORT=8787
# kill existing server on PORT if owned by python http.server
PID=$(lsof -ti tcp:$PORT || true)
if [ -n "${PID:-}" ]; then
  kill $PID || true
  sleep 0.3
fi
python3 -m http.server $PORT --directory "$ROOT/apps/promotion-dashboard" >/tmp/promotion_dashboard_server.log 2>&1 &
echo $! > /tmp/promotion_dashboard_server.pid
open "http://127.0.0.1:$PORT"
echo "Promotion dashboard running at http://127.0.0.1:$PORT"
