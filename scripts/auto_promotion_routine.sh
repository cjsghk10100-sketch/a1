#!/usr/bin/env bash
set -euo pipefail
cd /Users/min/.openclaw/workspaces/seogi

# Refresh dashboard source snapshots
python3 scripts/promotion_dashboard_sync.py >/dev/null 2>&1 || true
python3 scripts/promotion_tmp_index.py >/dev/null 2>&1 || true

# Import newly exported markdown files
python3 scripts/import_promotion_exports.py >/dev/null 2>&1 || true

# Apply promoted files if any
OUT=$(python3 scripts/apply_promotions.py)
APPLIED=$(echo "$OUT" | sed -n 's/Applied \([0-9][0-9]*\) promotion file(s)./\1/p')
APPLIED=${APPLIED:-0}

if [ "$APPLIED" -gt 0 ]; then
  TODAY=$(date +%F)
  DAILY="memory/daily/${TODAY}.md"
  [ -f "$DAILY" ] || echo "# Daily Log" > "$DAILY"
  echo "- [PROMOTE] 자동 루틴 적용: promoted/inbox -> applied (${APPLIED}건)" >> "$DAILY"
fi

echo "$OUT"
