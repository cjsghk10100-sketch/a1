# TASK-012 DB migration: core projections (rooms/threads/messages) + search (pg_trgm)

## Dependencies
- TASK-003 migration runner
- TASK-011 projector migration

## 1) Problem
We need core read models for:
- rooms
- threads
- messages
Plus a basic search table with trigram index.

## 2) Scope
In scope:
- Create tables:
  - proj_rooms
  - proj_threads
  - proj_messages
  - proj_search_docs
- Enable pg_trgm extension
- Add indexes for time-ordered reads and trigram search

Out of scope:
- approvals, incidents, survival ledgers

## 3) Constraints
- Must support EN + KO `lang` fields
- Deletions are logical (deleted boolean), not physical where possible

## 4) Repository context
Add:
- /apps/api/migrations/003_core_projections.sql

## 5) Acceptance criteria
- After migrate:
  - tables exist
  - `SELECT ... FROM proj_search_docs WHERE content_text ILIKE '%foo%'` works
  - trigram gin index exists

## 6) Steps
1) Create SQL migration:
   - CREATE EXTENSION IF NOT EXISTS pg_trgm;
2) proj_rooms:
   - room_id pk, workspace_id, mission_id, title, topic, room_mode, default_lang, tool_policy_ref
   - created_at/updated_at, last_event_id
   - index (workspace_id, mission_id)
3) proj_threads:
   - thread_id pk, workspace_id, room_id, title, status, created_at/updated_at, last_event_id
   - index (room_id, updated_at desc)
4) proj_messages:
   - message_id pk, workspace_id, room_id, thread_id, sender_type, sender_id, content_md, lang
   - parent_message_id, run_id, step_id, labels text[]
   - created_at/updated_at, deleted boolean, last_event_id
   - indexes: (room_id, created_at desc), (thread_id, created_at desc), (run_id, created_at desc)
5) proj_search_docs:
   - doc_id pk, workspace_id, room_id, thread_id, doc_type, content_text, lang, updated_at
   - gin trigram index on content_text

## 7) Risks
- Extension creation may fail if DB role lacks permission
  - Mitigation: in docker compose use superuser; document requirement

## 8) Rollback
Drop tables/extension only in dev environments.

