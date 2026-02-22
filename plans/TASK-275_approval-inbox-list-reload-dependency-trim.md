# TASK-275: Approval Inbox List Reload Dependency Trim

## Summary
Avoid unnecessary approval list reloads on selection changes by scoping list fetch effect to tab/status changes only.

## Problem
List reload effect depends on `selectedId`, so clicking different items repeatedly triggers redundant network reloads and can increase UI churn.

## Scope
- Use selected ID snapshot ref inside list fetch completion logic.
- Remove `selectedId` from list reload effect dependencies.

Out of scope:
- API changes
- Approval decision flow changes
- UI copy changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/ApprovalInboxPage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
