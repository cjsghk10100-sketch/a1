# TASK-008 Minimal Core API endpoints (Rooms/Threads/Messages)

## Dependencies
- TASK-010/011/012 migrations applied
- TASK-006 event store writer
- TASK-007 core projector

## 1) Problem
We need minimal commands/queries to verify end-to-end:
- commands write events
- projector updates projections
- queries read projections

## 2) Scope
In scope:
Commands:
- POST /v1/rooms
- POST /v1/rooms/:roomId/threads
- POST /v1/threads/:threadId/messages

Queries:
- GET /v1/rooms
- GET /v1/threads/:threadId/messages?limit=&before=

Out of scope:
- Approvals, policy gate, SSE, auth

## 3) Constraints
- Every command must:
  1) append event(s) to evt_events
  2) apply projector (sync) for those events
- Payloads must include default_lang and room_mode constraints

## 4) Repository context
Add/modify:
- /apps/api/src/routes/v1/rooms.ts
- /apps/api/src/routes/v1/threads.ts
- /apps/api/src/routes/v1/messages.ts (optional)
- /apps/api/src/routes/v1/index.ts
- /apps/api/src/server.ts (register v1 routes)

## 5) Acceptance criteria
- With DB up + migrations:
  - POST /v1/rooms returns room_id
  - GET /v1/rooms lists it
  - Create thread + message and GET messages returns it
- No duplicate projections if same request retried (best-effort; full idempotency later)

## 6) Steps
1) Define minimal request/response DTOs
2) For each command:
   - construct event payload
   - append to room/thread stream
   - call projector.apply(event)
3) Implement queries directly from proj_* tables

## 7) Risks
- Without auth, endpoints are open
  - Mitigation: for MVP testing only; add auth/policy later

## 8) Rollback
Revert route files.

