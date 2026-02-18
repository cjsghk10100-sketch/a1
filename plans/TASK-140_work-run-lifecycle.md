# TASK-140 Work: Run Lifecycle Controls (start/complete/fail)

## 1) Problem
We can create and inspect runs, but moving a run through its lifecycle still requires curl.
For local operation and Inspector validation, Work should be able to:
- start a queued run
- complete or fail a running run

## 2) Scope
In scope:
- Web-only:
  - Add web API helpers:
    - `startRun(run_id)` (POST `/v1/runs/:runId/start`)
    - `completeRun(run_id)` (POST `/v1/runs/:runId/complete`)
    - `failRun(run_id)` (POST `/v1/runs/:runId/fail`)
  - Work page:
    - Add per-run action buttons (Start/Complete/Fail) in the Runs list.
    - Refresh the Runs list after each action.
  - i18n strings (en/ko).

Out of scope:
- Any API/DB/migration changes.
- Step/toolcall/artifact UI controls (separate tasks).
- Editing run input/output payloads from UI (keep minimal).

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep UI minimal; do not break existing Work flows.

## 4) Repository context
Existing backend endpoints:
- `POST /v1/runs/:runId/start`
- `POST /v1/runs/:runId/complete`
- `POST /v1/runs/:runId/fail`

Files to change:
- `apps/web/src/api/runs.ts`
- `apps/web/src/pages/WorkPage.tsx`
- `apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- With local API running:
  - Create a run in `/work` -> status `queued`.
  - Click Start -> status becomes `running`.
  - Click Complete or Fail -> status becomes `succeeded` or `failed`.
  - Events are visible in `/inspector?run_id=...` (timeline shows lifecycle events).

## 6) Step-by-step plan
1. Add run lifecycle API helpers in `apps/web/src/api/runs.ts`.
2. Add per-row action buttons in `apps/web/src/pages/WorkPage.tsx`.
3. Add i18n keys (en/ko).
4. Run typecheck and ensure CI green.

## 7) Risks & mitigations
- Risk: Users click actions out of order.
  - Mitigation: Show buttons only when status makes sense; server also validates.

## 8) Rollback plan
Revert this PR (web-only changes).

