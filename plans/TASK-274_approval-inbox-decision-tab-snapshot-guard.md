# TASK-274: Approval Inbox Decision Tab Snapshot Guard

## Summary
Prevent decision-completion list refresh from overwriting approval list when the user changes tabs mid-request.

## Problem
`decide` refreshes list via `listApprovals(statusFilter)` using the request-start closure. If tab changes during the request, old-tab results can overwrite the currently visible tab list.

## Scope
- Snapshot active tab when decision starts.
- Use tab snapshot for list query.
- Apply tab guard before writing refreshed list state.

Out of scope:
- API changes
- Approval decision API payload changes
- UI copy changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/ApprovalInboxPage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
