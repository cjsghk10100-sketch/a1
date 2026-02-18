# TASK-143: Work Artifact Controls

## 1) Problem
Work UI supports runs/steps/toolcalls, but artifacts (the persistent outputs attached to steps) are still effectively read-only in the web client.
That forces curl/manual DB inspection to validate artifact flows during local operation.

## 2) Scope
In scope:
- Web API helper to create artifacts for a step (`POST /v1/steps/:stepId/artifacts`)
- Work page UI:
  - Select step
  - List artifacts for the selected step
  - Create a simple artifact (kind/title + content type + content payload)
- i18n strings (en/ko)

Out of scope:
- Any API/DB/event/projector changes
- File upload / binary artifacts (only `text/json/uri/none` payload per existing API)

## 3) Constraints (Security/Policy/Cost)
- No secrets in repo; do not add `.env`.
- Never eval user input; JSON is parsed with `JSON.parse` only.
- Keep changes scoped to `apps/web` + this plan file.

## 4) Repository context
Existing relevant files:
- `apps/api/src/routes/v1/artifacts.ts` (artifact endpoints)
- `apps/web/src/api/artifacts.ts` (listArtifacts)
- `apps/web/src/pages/WorkPage.tsx` (Work UI)
- `apps/web/src/i18n/resources.ts` (strings)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- Manual smoke:
  1. Open `/work`
  2. Start a run, create a step, invoke a toolcall (optional)
  3. Create an artifact on that step
  4. Confirm artifact list updates and inspector shows artifact events/read-model

## 6) Step-by-step plan
1. Extend `apps/web/src/api/artifacts.ts` with `createArtifact(stepId, payload)`.
2. Add an Artifacts section to `apps/web/src/pages/WorkPage.tsx` (step select + list + create form).
3. Add i18n keys in `apps/web/src/i18n/resources.ts` (en/ko).
4. Run `pnpm -r typecheck`.

## 7) Risks & mitigations
- Risk: invalid JSON content blocks creation.
  - Mitigation: show clear error; keep content optional; allow non-json types without parsing.

## 8) Rollback plan
- Revert this PR; no migrations involved.

