# TASK-168: Work Steps Run Storage Guard (Room-Bound Persistence)

## Summary
- Prevent stale run selection from being saved under a new room key during room switching.
- Persist `stepsRunId` only when the run belongs to the current room context.

## Scope
In scope:
- Work page localStorage persistence guard for steps run selection.

Out of scope:
- API or DB changes
- Event schema changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

## Acceptance
- Switching rooms no longer stores a previous room run id in the new room storage key.
- Valid run selections for the current room are still persisted.
