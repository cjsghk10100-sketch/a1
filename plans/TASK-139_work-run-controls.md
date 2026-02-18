# TASK-139 Work: Run Controls (create + recent list)

## 1) Problem
We can inspect Runs in `/inspector`, but creating/locating a `run_id` is still awkward during local operation.
To start operating the system from the app UI (no curl), Work should be able to:
- create a run for the selected room (optionally attached to the selected thread)
- show a recent runs list and deep-link to Inspector

## 2) Scope
In scope:
- Web-only:
  - Add `createRun()` API helper (POST `/v1/runs`).
  - Work page:
    - Create run form (title/goal optional; attach `thread_id` when selected).
    - Recent runs list (room-scoped via GET `/v1/runs?room_id=...`).
    - One-click open Inspector (`/inspector?run_id=...`).
  - i18n strings (en/ko).

Out of scope:
- Any API/DB/migration changes.
- Starting/completing/failing runs from UI.
- Steps/toolcalls/artifacts write actions.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep UX minimal; do not break existing Work flows.

## 4) Repository context
Existing backend endpoints:
- `POST /v1/runs` (create)
- `GET /v1/runs?room_id=...&limit=...` (list)

Files to change:
- `apps/web/src/api/runs.ts`
- `apps/web/src/pages/WorkPage.tsx`
- `apps/web/src/i18n/resources.ts`
- `apps/web/src/styles.css` (small additions only, if needed)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- With local API running:
  - Select room in `/work` and create a run (no curl).
  - Recent runs list refreshes for the room.
  - Clicking a run opens Inspector with the `run_id` prefilled.

## 6) Step-by-step plan
1. Add `createRun()` to `apps/web/src/api/runs.ts`.
2. Add room-scoped run create + list UI in `apps/web/src/pages/WorkPage.tsx`.
3. Add i18n keys (en/ko).
4. Run typecheck and ensure CI green.

## 7) Risks & mitigations
- Risk: Work page grows too large / confusing.
  - Mitigation: keep a single compact section and reuse existing UI patterns.

## 8) Rollback plan
Revert this PR (web-only changes).

