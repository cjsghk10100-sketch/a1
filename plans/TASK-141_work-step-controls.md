# TASK-141 Work: Step Controls (create + list)

## 1) Problem
We can create and transition Runs from the UI, but adding Steps still requires curl.
Steps are the unit that tool calls and artifacts attach to, so without step creation it's hard to exercise the Run timeline and Inspector realistically.

## 2) Scope
In scope:
- Web-only:
  - Add API helper: `createStep(run_id, { kind, title })` (POST `/v1/runs/:runId/steps`).
  - Work page:
    - Pick a run from the room's recent runs.
    - Load/list steps for the run.
    - Create a step (only when the run is `running`).
  - i18n strings (en/ko).

Out of scope:
- Any API/DB/migration changes.
- Tool call and artifact controls (separate tasks).
- Step succeed/fail endpoints (not present today).

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep UI minimal and consistent with existing Work patterns.

## 4) Repository context
Existing backend endpoints:
- `GET /v1/runs/:runId/steps` (list)
- `POST /v1/runs/:runId/steps` (create; requires run status `running`)

Files to change:
- `apps/web/src/api/runs.ts`
- `apps/web/src/pages/WorkPage.tsx`
- `apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- With local API running:
  - In `/work`, create a run and Start it.
  - Create a step for that run.
  - Steps list shows the new step.
  - Inspector shows the `step.created` event under the run.

## 6) Step-by-step plan
1. Add `createStep()` API helper.
2. Add Steps subsection to Work (select run, load list, create).
3. Add i18n keys (en/ko).
4. Run typecheck and ensure CI green.

## 7) Risks & mitigations
- Risk: User tries to create a step while run is not running.
  - Mitigation: disable create and show a small hint; API also enforces.

## 8) Rollback plan
Revert this PR (web-only changes).

