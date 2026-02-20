# TASK-175: Preserve Steps Run Selection While Runs Are Loading

## Summary
- Prevent transient runs-loading state from clearing selected steps run id.
- Keep selection stable during room switch/reload to avoid unnecessary storage churn.

## Scope
In scope:
- Work page auto-selection effect for `stepsRunId` based on `runs`.

Out of scope:
- API changes
- Steps/toolcalls/artifacts APIs

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

## Acceptance
- While `runsState === loading`, `stepsRunId` is not force-cleared.
- After loading completes, existing selection is validated as before.
