# Release Closeout (2026-03-06, KST)

## Scope
- Cycle type: release stabilization closeout only (no feature expansion).
- Contract policy: no API/schema/event/reason_code change.
- Maintained interface:
  - `POST /v1/engines/evidence/ingest`
  - `schema_version=2.1`

## Pinned Commits
- a1 runtime merge baseline: `10030bd9e25f709ed5a158eab32f2f2910bc93ad` (PR #114 merge commit)
- a1 docs closeout baseline: `fb942710e24fbb7702769dc9769e7cdf789d98ac` (PR #115 merge commit)
- a2 evidence baseline: `fb203a2f6eb4a353735c3ff6004cfc4bad357bd9` (`origin/main`)

## Merged PRs
- PR #114: `https://github.com/cjsghk10100-sketch/a1/pull/114`
  - merged at `2026-03-05T07:28:19Z`
  - merge commit: `10030bd9e25f709ed5a158eab32f2f2910bc93ad`
- PR #115: `https://github.com/cjsghk10100-sketch/a1/pull/115`
  - merged at `2026-03-05T13:26:17Z`
  - merge commit: `fb942710e24fbb7702769dc9769e7cdf789d98ac`

## Gate Evidence (Re-run Bundle)
- run date: `2026-03-06` (KST)
- local log bundle: `/tmp/release_closeout_20260306_005617`
- commands and outcomes:
  1. `bash /Users/min/Downloads/agent/scripts/e2e_engine_app_smoke.sh` -> PASS
  2. `bash /Users/min/Downloads/agent/scripts/e2e_engine_app_live_probe.sh` -> PASS (`ws_dev`)
  3. `bash /Users/min/Downloads/a2/mvp/scripts/quality_gate.sh` -> PASS
  4. `bash /Users/min/Downloads/a2/mvp/scripts/e2e_evidence_ingest.sh` -> PASS (`accepted=3`, `deduped=0`)
  5. `bash /Users/min/Downloads/a2/mvp/scripts/e2e_agentapp_bridge_worker.sh` -> PASS (`replay deduped=3`)

## Evidence Artifacts
- a2 full E2E evidence (tracked):
  - `/Users/min/Downloads/a2/mvp/evidence/e2e_agentapp_bridge_worker_20260306_005620.md`
- a2 previous evidence (tracked):
  - `/Users/min/Downloads/a2/mvp/evidence/e2e_agentapp_bridge_worker_20260305_164445.md`

## Operational Triage Order (Fixed)
When dashboard status is `DOWN`, triage order is fixed:
1. `401/403` auth/workspace mismatch
2. `cron_stale`
3. `projection_watermark_missing`
