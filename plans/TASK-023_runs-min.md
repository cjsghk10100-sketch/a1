# TASK-023: Runs (run.* / step.*) - schema + events + projector + API + contract test

## 1) Problem
We need a stable “Run unit” contract so Timeline/Inspector can rely on durable IDs and state without scraping raw events or reinventing semantics.

## 2) Scope
In scope:
- Event contracts:
  - `run.created` (v1)
  - `run.started` (v1)
  - `run.completed` (v1)
  - `run.failed` (v1)
  - `step.created` (v1)
- Projection tables:
  - `proj_runs` (current run state)
  - `proj_steps` (current step state)
- Projector: `runs` projector applying above events
- API endpoints (v1):
  - `POST /v1/runs` (create)
  - `POST /v1/runs/:runId/start`
  - `POST /v1/runs/:runId/complete`
  - `POST /v1/runs/:runId/fail`
  - `POST /v1/runs/:runId/steps` (create step)
  - `GET /v1/runs` (list)
  - `GET /v1/runs/:runId` (detail)
  - `GET /v1/runs/:runId/steps` (list steps)
- Contract test:
  - run + step events appear in **room SSE**
  - `run_id` / `step_id` are stable entity ids and differ from `event_id`
  - correlation_id stable across run events; causation_id chains correctly
  - projection tables reflect state changes

Out of scope:
- Tool invocation events (`tool.*`) and artifacts
- Full inspector “query events by run_id/correlation_id” endpoint
- Any UI work

## 3) Constraints (Security/Policy/Cost)
- No secrets committed; `.env` remains untracked.
- Room stream remains the primary realtime feed (room-scoped run events must append to room stream).
- IDs: entity ids (`run_*/step_*`) are distinct from event ids (UUID).

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/ids.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/index.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/streams.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/006_runs.sql`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/runs.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/runProjector.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/runs.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_runs.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green (typecheck + contract tests)
- Creating a run emits `run.created` in room SSE and inserts `proj_runs`
- Starting a run emits `run.started` with causation_id = prior run event_id and updates `proj_runs.status`
- Creating a step emits `step.created` and inserts `proj_steps`

## 6) Step-by-step plan
1. Add shared run event contract types in `packages/shared`.
2. Add `proj_runs` + `proj_steps` migration.
3. Implement run projector applying run/step events and updating projections.
4. Implement run routes (create/start/complete/fail/steps + read endpoints).
5. Add contract test and include it in `apps/api` test script.
6. Typecheck, open PR, ensure CI green.

## 7) Risks & mitigations
- Risk: scope/ordering changes later.
  - Mitigation: keep event payloads open via jsonb fields; order by occurred_at/room stream seq for now.

## 8) Rollback plan
Revert PR commit(s). If local DB already migrated, drop `proj_runs/proj_steps` or reset DB.

