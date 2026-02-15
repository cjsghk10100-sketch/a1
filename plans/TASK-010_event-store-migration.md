# TASK-010 DB migration: evt_events + evt_stream_heads (append-only)

## Dependencies
- TASK-002 Postgres infra
- TASK-003 migration runner

## 1) Problem
We need the event store tables defined in SPEC v1.1:
- evt_events (append-only)
- evt_stream_heads (stream_seq allocator)

## 2) Scope
In scope:
- SQL migration creating:
  - evt_events + indexes + constraints
  - evt_stream_heads
  - append-only guard (trigger to prevent UPDATE/DELETE on evt_events)
  - idempotency_key column + unique index (optional but recommended)

Out of scope:
- projection tables (TASK-011/012)

## 3) Constraints
- Append-only enforced at DB level (trigger)
- JSONB columns for policy_context/model_context/data

## 4) Repository context
Add:
- /apps/api/migrations/001_evt_event_store.sql

## 5) Acceptance criteria
- After `pnpm -C apps/api db:migrate`:
  - tables exist: evt_events, evt_stream_heads
  - UPDATE/DELETE on evt_events fails with exception
  - unique constraint on (stream_type, stream_id, stream_seq) exists

## 6) Steps
1) Create SQL migration with:
   - evt_events columns:
     - event_id text pk
     - event_type text
     - event_version int
     - occurred_at timestamptz
     - recorded_at timestamptz default now()
     - workspace_id text
     - mission_id/room_id/thread_id nullable
     - actor_type text check
     - actor_id text
     - run_id/step_id nullable
     - stream_type text check
     - stream_id text
     - stream_seq bigint
     - redaction_level text check + contains_secrets boolean
     - policy_context jsonb default {}
     - model_context jsonb default {}
     - display jsonb default {}
     - data jsonb not null
     - idempotency_key text null
   - evt_stream_heads:
     - stream_type, stream_id pk, next_seq bigint default 1
2) Add indexes:
   - unique (stream_type, stream_id, stream_seq)
   - (event_type, recorded_at desc)
   - (workspace_id, room_id, recorded_at desc)
3) Add append-only trigger:
   - BEFORE UPDATE OR DELETE ON evt_events => RAISE EXCEPTION
4) Add idempotency unique index:
   - unique (stream_type, stream_id, idempotency_key) WHERE idempotency_key IS NOT NULL

## 7) Risks
- Trigger blocks legitimate maintenance
  - Mitigation: keep trigger; maintenance should be through new events

## 8) Rollback
Revert migration by creating a new down-migration (or drop tables in dev only).
