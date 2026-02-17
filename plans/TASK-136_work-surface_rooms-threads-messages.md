# TASK-136: Work Surface (Rooms / Threads / Messages) Minimal UI

## 1) Problem
Right now, operating the system locally still requires curl (create room/thread/message).
We need a minimal “Work” surface inside the app so the OS can be used without copy/paste and without external chat channels.

## 2) Scope
In scope:
- API:
  - Add `GET /v1/rooms/:roomId/threads` (list projected threads for a room).
- Web:
  - Add a new `Work` page that can:
    - select a room
    - list/select threads in the room
    - show recent messages for the selected thread
    - send a message (creates `message.created`)
    - create a new thread in the room (creates `thread.created`)
    - create a new room (creates `room.created`)
  - Add nav + route (`/work`)
- Tests:
  - Extend an existing contract test to cover `GET /v1/rooms/:roomId/threads`.

Out of scope:
- Auth/RBAC.
- Pagination, search, or rich message rendering (markdown).
- Any DB migrations.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep changes additive: existing pages and endpoints must continue to work.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/threads.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_room_sse.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/App.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/*`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/*`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/styles.css`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  - `/work` loads rooms
  - can create a room, then create a thread, then send a message
  - Timeline shows the events; Inspector can open via the existing links.

## 6) Step-by-step plan
1. Add API endpoint `GET /v1/rooms/:roomId/threads` querying `proj_threads`.
2. Extend contract test to assert listing returns the created thread.
3. Add web API helpers for rooms/threads/messages.
4. Add `WorkPage` + route + nav item.
5. Add i18n keys and minimal CSS for layout.
6. Run typecheck + contract tests.

## 7) Risks & mitigations
- Risk: No rooms/threads exist yet.
  - Mitigation: include “Create room/thread” controls and keep manual ids optional.

## 8) Rollback plan
Revert PR (no migrations).

