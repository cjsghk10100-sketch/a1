# TASK-024: Events Query API (Inspector/Timeline reads)

## 1) Problem
We need stable read APIs for Inspector/Timeline that query the canonical event store (`evt_events`) by `run_id` / `correlation_id` / stream info, without requiring per-feature endpoints.

## 2) Scope
In scope:
- Add read endpoints:
  - `GET /v1/events` (filterable list)
  - `GET /v1/events/:eventId` (detail)
- Add indexes to support common inspector queries (`run_id`, `step_id`).
- Add contract test verifying:
  - `GET /v1/events?run_id=...` returns run chain and correct correlation/causation
  - `GET /v1/events?correlation_id=...` returns same chain
  - `GET /v1/events/:eventId` returns detail

Out of scope:
- UI work
- Any schema changes to existing event payloads

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Workspace scoping via `x-workspace-id` header.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/streams.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/appendEvent.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/events.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/007_evt_events_run_step_idx.sql`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_events_query.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green (typecheck + contract tests)
- `GET /v1/events` supports run_id/correlation_id filters

## 6) Step-by-step plan
1. Add events query routes.
2. Add run/step indexes on `evt_events`.
3. Add contract test and wire into api test script.
4. Open PR and verify CI.

## 7) Risks & mitigations
- Risk: stream_seq bigint precision in JSON.
  - Mitigation: keep current behavior (number) for now; revisit if needed.

## 8) Rollback plan
Revert PR. Indexes can remain harmless if already applied locally.

