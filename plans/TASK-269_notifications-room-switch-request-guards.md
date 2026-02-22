# TASK-269: Notifications Room-Switch Request Guards

## Summary
Harden Notifications page against stale async overwrites when room changes during in-flight requests.

## Problem
`fetchUnread` can resolve after the user switches rooms and overwrite the current room's view with events from a previous room. The room list refresh path also has no request-order guard.

## Scope
- Add request-order guard for rooms reload.
- Add request-order guard for unread event fetch.
- Bind unread results to the room snapshot used when request starts.

Out of scope:
- API changes
- Cursor semantics changes
- UI copy changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/NotificationsPage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
