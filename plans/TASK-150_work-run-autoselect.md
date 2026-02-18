# TASK-150: Work Run Auto-Select (Steps)

## 1) Problem
After creating a new Run in Work, the Steps section may remain focused on a previously selected run. This adds friction when doing the normal local loop: create run → start → create step → tool calls/artifacts.

## 2) Scope
In scope:
- Web-only: after Run creation succeeds, auto-select that run in the Steps "Run" selector.
- No API changes.

Out of scope:
- Any API/DB/event/projector changes.
- Changing list ordering or run creation payload.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep changes scoped to `apps/web` + this plan file.

## 4) Repository context
Relevant file:
- `apps/web/src/pages/WorkPage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Manual smoke (with local API running):
  1. `/work` → create run while another run is selected in Steps.
  2. Confirm Steps selector switches to the newly created run automatically.

## 6) Step-by-step plan
1. In the run create success path, set `stepsRunId` to the created `run_id`.
2. Run typecheck and ensure CI green.

## 7) Risks & mitigations
- Risk: selection changes before runs list refreshes.
  - Mitigation: set selection after reloading runs.

## 8) Rollback plan
Revert this PR (web-only change).

