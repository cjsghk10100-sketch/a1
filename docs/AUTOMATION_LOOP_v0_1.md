# Automation Loop v0.1 (PR-9)

## Scope
- Trigger source: `scorecard.recorded`, `run.failed` (post-commit only).
- Emission scope: `incident.opened`, `message.created` only.
- No auto execution, no privilege change, no projection writes.

## Kill Switch
- `PROMOTION_LOOP_ENABLED`:
  - unset: enabled
  - `0|false|off|no`: no-op (zero emission)

## Actions
- Failed run triage:
  - emit `incident.opened` (`category=run_failed`)
  - optional `message.created(intent=request_human_decision)` when escalation rule is met
- Scorecard iteration overflow:
  - emit `incident.opened` (`category=iteration_overflow`)
  - optional `message.created(intent=request_human_decision)` for high risk
- Scorecard PASS:
  - emit `message.created(intent=request_approval)` only if orphan/terminal/active-incident guards pass

## Idempotency
- All automation emissions set `evt_events.idempotency_key`.
- Duplicate (`err.code=23505`) is replay-safe (no throw).

## Failure Safety
- Automation runs fire-and-forget after core commit.
- Failures cannot rollback core write.
- Minimal retry: one immediate retry before fallback.

## Failure Telemetry (PR-15)
- On `applyAutomation` failure, one structured warn log is emitted:
  - `event=automation.apply_failed`
  - `trace_key=auto_fail:{workspace_id}:{run_id_or_scorecard_id}:{event_id_or_no_evt}`
  - `reason_code` (safe extraction, fallback `unknown`)
  - `workspace_id`, `entity_type`, `run_id`, `scorecard_id`, `correlation_id`, `request_id`, `timestamp`
- Security guard:
  - no raw `err` object
  - no `err.message`/stack
  - no payload/tool args/artifact URLs/tokens/secrets

Example grep:
```bash
rg "automation\\.apply_failed|auto_fail:" /path/to/logs
```

Example log line:
```json
{
  "event":"automation.apply_failed",
  "trace_key":"auto_fail:ws_abc:run_123:evt_456",
  "workspace_id":"ws_abc",
  "reason_code":"unknown",
  "entity_type":"run",
  "run_id":"run_123",
  "scorecard_id":null,
  "correlation_id":"corr_abc",
  "request_id":"req_abc",
  "timestamp":"2026-03-03T01:23:45.678Z"
}
```
