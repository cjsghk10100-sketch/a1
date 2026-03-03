# TASK-414: PR-15 applyAutomation failure telemetry

## Problem
Automation failures are currently hard to diagnose in one hop and existing logs include raw error objects/messages, which can leak sensitive content.

## Scope
In scope:
- Add one structured warn telemetry log at the single applyAutomation owner catch point.
- Add safe reason-code extraction and deterministic trace_key generation.
- Add test-only telemetry hook for deterministic contract tests.
- Add contract test coverage for success/failure/kill-switch/no-trace context.

Out of scope:
- No DB schema/event/endpoint/reason-code changes.
- No behavior changes in automation success/failure handling.

## Constraints
- Telemetry must never alter control flow and must swallow logger failures.
- No raw `err` object or `err.message` in telemetry logs.
- No payload/tool args/secrets in logs.

## Files
- `apps/api/src/automation/promotionLoop.ts`
- `apps/api/test/contract_automation_telemetry.ts`
- `apps/api/package.json`
- `docs/AUTOMATION_LOOP_v0_1.md`

## Acceptance
- Single structured warn log on applyAutomation failure with required fields.
- No duplicate telemetry lines from retry internals.
- Test-only hook captures payload under NODE_ENV=test.
- Contract test passes and package test chain includes new test.
