# TASK-006 Event store writer module (code only)

## Dependencies
- TASK-003 migration runner
- TASK-005 API skeleton
- TASK-010 event store DB migration must be applied before runtime tests

## 1) Problem
We need a reusable module to append events to evt_events with:
- stream_seq allocation via evt_stream_heads
- optional idempotency_key support
- clean interface for commands

## 2) Scope
In scope:
- Implement eventStore functions in apps/api:
  - allocateStreamSeq()
  - appendEvent()
  - appendToStream() (alloc + insert)
- Use pg transactions
- Return inserted event envelope

Out of scope:
- Projectors and read models
- SSE streaming

## 3) Constraints
- Append-only: no updates/deletes on evt_events
- Must not log secrets
- Must include policy_context/model_context placeholders (JSONB)

## 4) Repository context
Add:
- /apps/api/src/eventStore/allocateSeq.ts
- /apps/api/src/eventStore/appendEvent.ts
- /apps/api/src/eventStore/index.ts

Modify:
- /apps/api/src/db/pool.ts (export typed pool)
- /packages/shared/src/events.ts (ensure envelope aligns)

## 5) Acceptance criteria
- Typecheck passes
- Provide a small script:
  - /apps/api/scripts/dev_append_room_event.ts that appends a test event (manual run)
- After TASK-010 migration:
  - Running the script inserts a row into evt_events and advances stream_seq

## 6) Steps
1) Implement allocateStreamSeq(stream_type, stream_id):
   - SELECT ... FOR UPDATE from evt_stream_heads; insert if missing
2) Implement appendEvent(tx, event):
   - INSERT into evt_events with stream_seq already known
3) Implement appendToStream(pool, envelope):
   - transaction wrapper: alloc seq then insert
4) Add dev script to exercise module

## 7) Risks
- Concurrency: stream_seq collisions
  - Mitigation: row-level lock on evt_stream_heads

## 8) Rollback
Revert module; DB unchanged.
