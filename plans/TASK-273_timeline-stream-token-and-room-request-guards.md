# TASK-273: Timeline Stream Token and Room Request Guards

## Summary
Harden Timeline page against stale room-list loads and stale SSE callbacks during room switch/reconnect races.

## Problem
- Room refresh has no request-order guard, so older responses can overwrite newer room list state.
- SSE callbacks can arrive around room switch/reconnect boundaries and apply updates to the wrong active room context.

## Scope
- Add room list request-order guard (`reloadRooms`).
- Add stream token guard for SSE lifecycle (`connect`/`disconnect`/`onmessage`/`onerror`).
- Bind cursor persistence to the room snapshot used to start the stream.

Out of scope:
- API changes
- Event payload changes
- Timeline UI copy changes

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/TimelinePage.tsx`

## Acceptance
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
