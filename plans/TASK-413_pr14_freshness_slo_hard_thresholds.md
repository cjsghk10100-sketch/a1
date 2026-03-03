# TASK-413: PR-14 System Health Freshness SLO Hard Thresholds

## Problem
System-health summary thresholds are currently env-driven (`HEALTH_DOWN_CRON_FRESHNESS_SEC`, `HEALTH_DOWN_PROJECTION_LAG_SEC`, `HEALTH_DEGRADED_DLQ_BACKLOG`). This can cause environment drift and unstable downgrade behavior.

## Scope
In scope:
- Freeze the 3 freshness SLO thresholds as hard constants.
- Keep summary/drilldown behavior and response shape unchanged.
- Add cache-clear test hygiene and deterministic contract checks for threshold boundaries.

Out of scope:
- reason_code/schema_version/event changes
- cache/circuit-breaker redesign
- projector/DB schema changes

## Constraints
- DB now() for all freshness/lag calculations.
- No hardcoded HTTP status codes outside existing mapping helper usage.
- No behavior drift beyond threshold source replacement.

## Files
- `apps/api/src/routes/v1/system-health.ts`
- `apps/api/test/contract_system_health_summary.ts`
- `docs/SYSTEM_HEALTH_v0_2.md`

## Acceptance
- Thresholds fixed to 600/300/10 and no env reads for those keys.
- Summary/drilldown contracts still green.
- `clearHealthCache()` used in summary test scenarios.
- Verification grep confirms removed env threshold reads.
