# TASK-052 Run Inspector (timeline + drilldown)

## 1) Problem
We need a stable "Inspector" screen to debug and audit the system by inspecting a Run unit (run/steps/toolcalls/artifacts) and its related event timeline. This must be a thin consumer of existing backend contracts so future updates stay safe.

## 2) Scope
In scope:
- Implement Inspector UI that can:
  - Load a Run by `run_id` and show summary
  - List steps for the run
  - List tool calls and artifacts for the run
  - Show the event timeline for the run (`/v1/events?run_id=...`)
  - Drill into a specific event (`/v1/events/:eventId`) and render details (redacted JSON)
- Support deep-linking via query params (e.g. `?run_id=...` or `?correlation_id=...` for event search).
- All visible strings i18n (en/ko).
- Redact JSON by default (no raw secrets rendered).

Out of scope:
- Any backend/DB/migration changes.
- Write actions for runs/steps/toolcalls/artifacts (read-only inspector).
- Full-text search and advanced filters (future).

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Conservative redaction for JSON views.

## 4) Repository context
Relevant backend endpoints:
- Runs: `GET /v1/runs/:runId`, `GET /v1/runs/:runId/steps`
- Events: `GET /v1/events?run_id=...&correlation_id=...`, `GET /v1/events/:eventId`
- Tool calls: `GET /v1/toolcalls?run_id=...`
- Artifacts: `GET /v1/artifacts?run_id=...`

Files to change (web only):
- `apps/web/src/pages/InspectorPage.tsx`
- `apps/web/src/i18n/resources.ts`
- Add minimal `apps/web/src/api/{events,runs,toolcalls,artifacts}.ts`
- `apps/web/src/styles.css` (small additions only)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- With local API running and a run present:
  - Enter `run_id` -> run summary loads
  - Steps/toolcalls/artifacts lists load
  - Events timeline loads and event details can be expanded

## 6) Step-by-step plan
1) Add small API helpers for runs/events/toolcalls/artifacts.
2) Implement Inspector page with search inputs and sections.
3) Add event detail drilldown using `/v1/events/:eventId`.
4) Add i18n keys (en/ko).
5) Confirm typecheck + CI.

## 7) Risks & mitigations
- Risk: event payloads are large or contain secrets
  - Mitigation: collapsed details + conservative redaction.

## 8) Rollback plan
Revert this PR (web-only changes).

