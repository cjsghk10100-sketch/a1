# TASK-148: Work Artifact Metadata (JSON)

## 1) Problem
Work UI can create artifacts, but cannot set `metadata`. That forces curl/DB for common cases where artifacts need structured context (source, labels, eval scores, etc.).

## 2) Scope
In scope:
- Web-only: add an optional `metadata (JSON)` input to the Work "Artifacts" create form.
- Parse JSON with `JSON.parse` (no eval); if invalid, show `invalid_json` and do not send the request.
- Send `metadata` to the existing API (`POST /v1/steps/:stepId/artifacts`).
- i18n strings (en/ko).

Out of scope:
- Any API/DB/event/projector changes.
- Artifact schema changes.
- Editing existing artifacts.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Never eval user input; JSON is parsed with `JSON.parse` only.
- Keep changes scoped to `apps/web` + this plan file.

## 4) Repository context
Existing backend API already accepts metadata:
- `apps/api/src/routes/v1/artifacts.ts` supports `metadata?: Record<string, unknown>`.
- `apps/web/src/api/artifacts.ts` already includes `metadata?: unknown` in `createArtifact()`.

Files to change:
- `apps/web/src/pages/WorkPage.tsx`
- `apps/web/src/i18n/resources.ts`
- `plans/TASK-148_work-artifact-metadata.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Manual smoke (with local API running):
  1. Open `/work`, select a room, start a run, create a step.
  2. In Artifacts, select the step, set content, set `metadata` JSON, create artifact.
  3. Artifact appears in the list and "Advanced" view shows `metadata` populated.

## 6) Step-by-step plan
1. Add a `metadata (JSON)` textarea to the artifact create form.
2. When creating, trim and parse JSON if provided.
3. Send `metadata` in `createArtifact(step_id, ...)`.
4. Add i18n keys (en/ko).
5. Run typecheck and ensure CI green.

## 7) Risks & mitigations
- Risk: invalid JSON blocks create action.
  - Mitigation: metadata is optional; show `invalid_json` immediately.

## 8) Rollback plan
Revert this PR (web-only changes).

