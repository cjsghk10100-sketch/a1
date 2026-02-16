# TASK-134: Inspector Recent Runs Picker (Reduce Copy/Paste)

## 1) Problem
The Inspector currently requires manually pasting a `run_id`, which is error-prone (e.g., pasting an incorrect/partial id).
We want a simple “recent runs” picker to load a run without leaving the UI.

## 2) Scope
In scope:
- Web:
  - Add a “Recent runs” select in the Inspector (Run mode).
  - Add a refresh button and basic error/loading states.
- Web API helper:
  - Add `listRuns()` to call `GET /v1/runs?limit=…`.
- i18n (en/ko) for new strings.

Out of scope:
- Any API/DB changes.
- Filtering by room/status (keep minimal first).

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep this additive; existing Inspector flows must still work.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/runs.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- Inspector page:
  - shows recent runs list
  - selecting a run loads it successfully (equivalent to pasting run id + Load)

## 6) Step-by-step plan
1. Add `listRuns({limit})` API helper.
2. Add recent runs UI in Inspector (run mode only).
3. Wire selection to `loadByRun`.
4. Add i18n keys.
5. Typecheck.

## 7) Risks & mitigations
- Risk: DB has no runs yet.
  - Mitigation: show empty placeholder and keep manual input.

## 8) Rollback plan
Revert PR (web-only).

