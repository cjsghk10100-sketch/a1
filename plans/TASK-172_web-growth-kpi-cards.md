# TASK-172: Web Growth KPI Cards (7D Delta Summary)

## Summary
- Add top-level growth KPI cards in Agent Profile Growth tab.
- Surface quick signals without opening advanced JSON:
  - trust score (7D delta),
  - autonomy rate (7D delta),
  - new skills learned (latest 7D),
  - repeated mistakes (latest 7D).

## Scope
In scope:
- UI-only summary cards based on existing trust/snapshot fields.
- EN/KO i18n labels for KPI cards.

Out of scope:
- API/DB changes
- Trust model change

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/styles.css`

## Acceptance
- Growth tab displays 4 KPI cards above detailed sections.
- Cards update when trust/snapshot data changes.
