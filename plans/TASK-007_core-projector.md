# TASK-007 Core projector (rooms/threads/messages) + applied_events idempotency

## Dependencies
- TASK-011 projector tables migration
- TASK-012 core projection tables migration
- TASK-006 event store writer module

## 1) Problem
We need an idempotent projector that updates read models from events:
- proj_rooms, proj_threads, proj_messages
- record applied event ids to avoid double-apply

## 2) Scope
In scope:
- Implement coreProjector.apply(event)
- Implement projector idempotency using proj_applied_events (insert first; on conflict skip)
- Support event types:
  - room.created / room.updated
  - thread.created
  - message.created

Out of scope
- Search indexing (optional later)
- Tool calls, approvals, survival ledger

## 3) Constraints
- Must be deterministic (same events => same projections)
- Must not require event mutation
- Avoid heavy ORMs; use SQL queries

## 4) Repository context
Add:
- /apps/api/src/projectors/coreProjector.ts
- /apps/api/src/projectors/types.ts
- /apps/api/src/projectors/index.ts
- /apps/api/src/projectors/projectorDb.ts (helpers for applied_events)

## 5) Acceptance criteria
- After migrations applied:
  - A script can append room.created and run projector => proj_rooms has a row
- Projector is safe to re-run on same event_id (no duplicates)

## 6) Steps
1) Define canonical event payload shapes in shared (or locally) for the 4 event types
2) Implement `tryMarkApplied(projector_name, event_id)`:
   - insert into proj_applied_events; return false if conflict
3) Implement apply(event):
   - switch on event_type
   - upsert into relevant proj_* table
4) Add a script `/apps/api/scripts/dev_projector_smoke.ts`:
   - append events then apply them

## 7) Risks
- Schema drift between event payload and projection columns
  - Mitigation: keep payload minimal and explicit

## 8) Rollback
Revert projector code; projections can be rebuilt from evt_events later.
