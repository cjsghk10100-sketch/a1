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
