# TASK-174: Web Action Registry Visibility (Reversible/Zone/Approval)

## Summary
- Expose action registry in Agent Profile Permissions tab.
- Show reversible policy and required zone/pre/post review flags from `/v1/action-registry`.

## Scope
In scope:
- New web API helper for action registry.
- Permissions UI card/table for action policy visibility.
- EN/KO i18n keys for section and columns.

Out of scope:
- API behavior changes
- Policy engine logic changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/actionRegistry.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## Acceptance
- Permissions tab loads and shows action registry rows.
- Operators can see reversible, zone, pre-approval, and post-review flags per action.
