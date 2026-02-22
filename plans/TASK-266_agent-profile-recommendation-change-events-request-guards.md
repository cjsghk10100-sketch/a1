# TASK-266: Agent Profile Request Ordering Guards (Recommendation + Change Timeline)

## Summary
Harden Agent Profile against stale async overwrites by adding request-order guards to approval recommendation and change timeline loads.

## Problem
`reloadApprovalRecommendation` and `reloadChangeEvents` only gate by current agent ID. When multiple requests overlap (manual refresh, trust recalc, quarantine actions, rapid selection changes), an older response can still race and override newer data/loading state.

## Scope
- Add per-query request sequence guards:
  - approval recommendation
  - change timeline events
- Ensure state updates happen only for latest in-flight request.

Out of scope:
- API changes
- UI copy changes
- Additional endpoints

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
