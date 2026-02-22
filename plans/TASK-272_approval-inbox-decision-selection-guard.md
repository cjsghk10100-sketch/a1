# TASK-272: Approval Inbox Decision Selection Guard

## Summary
Prevent stale decision completions from overwriting the currently selected approval detail.

## Problem
If a decision request is in-flight and the user selects another approval, the previous completion can still write detail/error state for the old item.

## Scope
- Snapshot selected approval ID at decision start.
- Add decision request token guard for overlapping requests.
- Apply guarded writes for detail/error/loading updates in `decide`.

Out of scope:
- API changes
- Approval list query behavior changes
- UI copy changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/ApprovalInboxPage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
