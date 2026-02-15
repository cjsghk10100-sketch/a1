# TASK-011 DB migration: projector cursors + applied_events

## Dependencies
- TASK-003 migration runner
- TASK-010 event store migration

## 1) Problem
Projectors need:
- cursor state per projector
- idempotency guard per event

## 2) Scope
In scope:
- Create tables:
  - proj_projectors (cursor)
  - proj_applied_events (idempotency by projector_name + event_id)

Out of scope:
- actual projection tables (TASK-012)

## 3) Constraints
- Must allow multiple projectors
- Idempotency must be enforced by primary key

## 4) Repository context
Add:
- /apps/api/migrations/002_projector_state.sql

## 5) Acceptance criteria
- After migrate:
  - tables exist with correct PKs
  - inserting same (projector_name, event_id) twice fails

## 6) Steps
1) Create SQL migration:
   - proj_projectors(projector_name pk, last_recorded_at timestamptz, last_event_id text)
   - proj_applied_events(projector_name, event_id, applied_at timestamptz default now(), PRIMARY KEY (projector_name, event_id))
2) Add index on proj_projectors(last_recorded_at)

## 7) Risks
- Cursor strategy may change later
  - Mitigation: keep schema minimal; projector can ignore cursor if using applied_events

## 8) Rollback
Drop tables in dev-only migration if needed.
