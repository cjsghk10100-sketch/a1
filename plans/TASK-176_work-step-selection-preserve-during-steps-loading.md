# TASK-176: Preserve Step Selection While Steps Are Loading

## Summary
- Prevent transient steps-loading state from clearing selected step ids.
- Keep `toolCallsStepId` and `artifactsStepId` stable while `steps` are loading.

## Scope
In scope:
- Work page auto-selection effects for tool-calls/artifacts step ids.

Out of scope:
- API changes
- Toolcall/artifact behavior changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

## Acceptance
- During `stepsState === loading`, selected step ids are not force-cleared.
- After loading completes, selected step ids are validated as before.
