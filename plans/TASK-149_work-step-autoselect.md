# TASK-149: Work Step Auto-Select (Tool calls / Artifacts)

## 1) Problem
After creating a new Step in Work, the Tool calls / Artifacts sections may still point at an older step. This adds extra clicks and makes local “create step → invoke tool → attach artifact” loops slower.

## 2) Scope
In scope:
- Web-only: after Step creation succeeds, auto-select that step for:
  - Tool calls step selector
  - Artifacts step selector
- No API changes.

Out of scope:
- Any API/DB/event/projector changes.
- Changing list ordering.
- Auto-selecting runs (already handled).

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep changes scoped to `apps/web` + this plan file.

## 4) Repository context
Relevant file:
- `apps/web/src/pages/WorkPage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Manual smoke (with local API running):
  1. `/work` → create + start run
  2. Create a step
  3. Confirm Tool calls and Artifacts sections switch to the new step automatically.

## 6) Step-by-step plan
1. In the step create success path, set `toolCallsStepId` and `artifactsStepId` to the created `step_id`.
2. Run typecheck and ensure CI green.

## 7) Risks & mitigations
- Risk: selection changes before steps list refreshes.
  - Mitigation: apply selection after reloading steps.

## 8) Rollback plan
Revert this PR (web-only change).

