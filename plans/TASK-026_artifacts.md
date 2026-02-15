# TASK-026: Artifacts (artifact.*) - contract + projections + API + tests

## 1) Problem
Timeline/Inspector needs a stable, queryable representation of “artifacts” produced during runs (files, text blobs, JSON outputs, etc.) with durable ids and audit trail.

## 2) Scope
In scope:
- Event contract:
  - `artifact.created` (v1)
- Projection table:
  - `proj_artifacts` (current artifact metadata)
- Projector: `artifacts` projector applying `artifact.created`
- API endpoints (v1):
  - `POST /v1/steps/:stepId/artifacts` (create, returns `artifact_id`)
  - `GET /v1/artifacts` (filters: run_id, step_id, room_id)
  - `GET /v1/artifacts/:artifactId`
- Contract test:
  - create artifact -> room SSE includes `artifact.created`
  - `artifact_id` differs from `event_id`
  - correlation_id matches run correlation; causation_id uses latest step event
  - projection row exists and endpoints return it

Out of scope:
- Binary blob storage, streaming downloads, large payload handling
- Artifact updates/deletes

## 3) Constraints (Security/Policy/Cost)
- Do not store secrets in artifacts.
- Keep payloads small; store metadata + optional small inline payload.
- Room stream remains primary realtime feed for room-scoped runs.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/ids.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/runs.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/streams.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/009_artifacts.sql`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/artifacts.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/artifactProjector.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/artifacts.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_artifacts.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green (typecheck + contract tests)
- Artifact create inserts `proj_artifacts` and can be listed/fetched

## 6) Step-by-step plan
1. Add shared artifact contract + ArtifactId in `packages/shared`.
2. Add `proj_artifacts` migration.
3. Implement artifact projector.
4. Implement artifact routes and register in v1.
5. Add contract test and include in api test script.
6. Typecheck, PR, CI, merge.

## 7) Risks & mitigations
- Risk: artifact storage needs changes for large/binary blobs later.
  - Mitigation: keep metadata stable and use `uri` + `storage` fields; treat inline payload as optional.

## 8) Rollback plan
Revert PR. If migration already applied locally, drop `proj_artifacts` or reset DB.

