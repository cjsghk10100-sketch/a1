# TASK-171: Web Delegation Graph Visual (Token Chain)

## Summary
- Add a compact delegation graph view in Agent Profile.
- Render capability token chain with depth and parent linkage for faster audit reading.

## Scope
In scope:
- UI-only visualization using existing capability token data.
- EN/KO labels for delegation graph section.

Out of scope:
- Token model/API changes.
- Delegation policy changes.

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/styles.css`

## Acceptance
- Delegation section shows depth-ordered chain rows.
- Rows indicate token id, depth, and parent token id when available.
