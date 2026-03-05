# System Health v0.2

## Scope
- Endpoint: `POST /v1/system/health`
- Compatibility: PR-8 response contract is preserved; v0.2 adds summary fields only.
- SSOT remains `evt_events` (append-only). Health routes never write events.

## Metrics
- `cron_freshness_sec`:
  - Global watchdog (`cron_health`) freshness from critical checks.
  - `NULL` means never succeeded / missing watchdog freshness.
- `projection_lag_sec`:
  - `latest_event_at = MAX(evt_events.occurred_at)` per workspace.
  - `watermark_at = projector_watermarks.last_applied_event_occurred_at` per workspace.
  - If watermark is missing, the route uses a projection `updated_at` fallback (workspace-scoped) to avoid permanent false DOWN while watermark writers are not fully rolled out.
  - Formula:
    - no events: `0`
    - events + missing watermark: `NULL`
    - otherwise: `GREATEST(0, EXTRACT(EPOCH FROM (latest_event_at - watermark_at)))`
- `dlq_backlog_count`: workspace-scoped pending DLQ count.
- `rate_limit_flood_detected`: workspace-scoped boolean signal from rate-limit projections.
- `active_incidents_count`: workspace-scoped count of active incidents.

## Status Thresholds
- `DOWN`:
  - `cron_freshness_sec > 600` or `NULL`
  - OR `projection_lag_sec > 300`
  - OR events exist and watermark is missing (`projection_lag_sec = NULL`)
- `DEGRADED` (when not DOWN):
  - `dlq_backlog_count > 10`
  - OR `active_incidents_count > 0`
  - OR `rate_limit_flood_detected = true`
- `OK`: otherwise.

Hard constants (PR-14):
- `DOWN_CRON_FRESHNESS_SEC = 600`
- `DOWN_PROJECTION_LAG_SEC = 300`
- `DEGRADED_DLQ_BACKLOG_THRESHOLD = 10`

Env overrides:
- `HEALTH_DB_STATEMENT_TIMEOUT_MS` (default `2000`)

## Operator Triage Order (`DOWN`)
When dashboard/runtime reports `DOWN`, triage in this order:

1. Auth/workspace mismatch (`401/403`) first.
   - If `/v1/system/health` returns `401` or `403`, treat as auth/workspace issue and stop health triage.
2. `cron_stale`.
   - Check `summary.top_issues` and drilldown kind `cron_stale`.
3. `projection_watermark_missing`.
   - Check `summary.top_issues` and drilldown kind `projection_watermark_missing`.
   - Handle this only after auth and `cron_stale` are ruled out.
   - Immediate recovery command:
     - `bash /Users/min/agentapp/scripts/bootstrap_workspace_health.sh --workspace ws_dev`
   - Then re-validate:
     - `bash /Users/min/agentapp/scripts/e2e_engine_app_live_probe.sh`

## Immediate Recovery: `projection_watermark_missing`
Use this runbook step when `summary.top_issues` contains `projection_watermark_missing`:

1. Optional dry-run preview:
   - `bash /Users/min/agentapp/scripts/bootstrap_workspace_health.sh --workspace ws_dev --dry-run`
2. Apply bootstrap:
   - `bash /Users/min/agentapp/scripts/bootstrap_workspace_health.sh --workspace ws_dev`
3. Confirm health gate:
   - `bash /Users/min/agentapp/scripts/e2e_engine_app_live_probe.sh`
4. Success condition:
   - `/v1/system/health` summary reports `health_summary=OK`
   - `top_issues` does not include `projection_watermark_missing`

## Stage B Observation Thresholds (24h Window)
After applying Stage B (`ENGINE_INGEST_LEGACY_FALLBACK=0`), use this fixed threshold policy:

1. `401/403`
   - tolerated count: `0` on authenticated probes.
   - if repeated across two consecutive checks (5-minute interval), trigger rollback (`fallback=1`).
2. `cron_stale`
   - alert trigger: `summary.top_issues` includes `cron_stale` for `2` consecutive checks.
   - rollback after trigger, then investigate cron freshness source.
3. `projection_watermark_missing`
   - alert trigger: `summary.top_issues` includes `projection_watermark_missing` for `2` consecutive checks.
   - rollback after trigger, then investigate projector/watermark pipeline.

## Caching Semantics
- Per-workspace cache entry stores `{ payload, stored_at_ms, ttl_ms }`.
- TTL defaults:
  - `OK`/`DEGRADED`: `15s` (`HEALTH_CACHE_TTL_SEC`)
  - `DOWN`: `5s` (`HEALTH_ERROR_CACHE_TTL_SEC`)
- Cache growth is bounded with max entries (`HEALTH_CACHE_MAX_ENTRIES`, default `512`) and stale-entry pruning.
- `server_time` is always live from DB `now()` and is never served from cache.
- Singleflight is used per workspace to avoid stampede.

## Privacy Guard
- `top_issues[].details` is numeric/boolean only.
- No raw DLQ text, incident titles, user content, or DB/internal error strings are returned.

## Rollback
- Safe rollback is route-level:
  - Revert `system-health` summary logic and test wiring.
  - Keep `projector_watermarks` table in place (operational, backward-compatible, can remain unused).
