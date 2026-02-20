# TASK-170: Web Approval Mode Recommendation (Pre/Post/Auto)

## Summary
- Add a policy recommendation view in Agent Profile using existing signals:
  - trust score,
  - quarantine status,
  - capability scope (external/high-stakes/write).
- Show recommended mode per target class:
  - internal reversible write,
  - external write,
  - high-stakes irreversible action.

## Scope
In scope:
- Web UI computed recommendation only (no backend change).
- EN/KO labels for recommendation states.

Out of scope:
- Policy engine behavior changes
- Approval enforcement changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## Acceptance
- Permissions tab shows recommendation rows with `auto/post/pre/blocked`.
- Recommendation updates when trust/quarantine/scope changes.
