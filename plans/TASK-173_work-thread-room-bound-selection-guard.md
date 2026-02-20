# TASK-173: Work Thread Selection Guard (Room-Bound Reload/Persist)

## Summary
- Ensure thread persistence and message reload only happen when selected thread belongs to current room.
- Prevent cross-room thread message bleed during fast room switching.

## Scope
In scope:
- Update thread selection effect in Work page.

Out of scope:
- API/DB changes
- Search/thread creation logic changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

## Acceptance
- On room switch, old room thread is not persisted into new room key.
- Messages reload only for thread ids confirmed in current room thread list.
