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

Env overrides:
- `HEALTH_DOWN_CRON_FRESHNESS_SEC` (default `600`)
- `HEALTH_DOWN_PROJECTION_LAG_SEC` (default `300`)
- `HEALTH_DEGRADED_DLQ_BACKLOG` (default `10`)
- `HEALTH_DB_STATEMENT_TIMEOUT_MS` (default `2000`)

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
