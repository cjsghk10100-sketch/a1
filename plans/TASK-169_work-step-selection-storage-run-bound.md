# TASK-169: Work Step Selection Storage Guard (Run-Bound Persistence)

## Summary
- Prevent stale step selections from being stored under a different run key.
- Guard persistence for `toolCallsStepId` and `artifactsStepId` so writes occur only when the step belongs to current selected run.

## Scope
In scope:
- Web Work page localStorage persistence guards for step selections.

Out of scope:
- API/DB/event changes
- UI flow refactor

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

## Acceptance
- Run switch does not persist previous run step ids into new run storage keys.
- Valid selections for the current run are persisted as before.
