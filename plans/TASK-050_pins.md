# TASK-050: Pins (threads/messages) for Work surface

## 1) Problem
Operating locally gets noisy fast. We need a lightweight way to keep key items handy (important threads and specific messages) without hunting through lists or re-searching.

## 2) Scope
In scope:
- Web UI (local-only):
  - Add a "Pins" section to `/work` for the selected room.
  - Allow pin/unpin for:
    - threads
    - messages
  - Persist pins in `localStorage` (single-user local-first).
  - Clicking a pinned item navigates to the correct thread.

Out of scope:
- DB/API changes (pins are not an OS/audit concept yet).
- Pins for artifacts/runs/memory (future extension).
- Cross-device sync / multi-user pin sharing.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep changes additive; do not break existing Work flows.
- Storage format should be versioned so we can migrate later (`agentapp.pins.v1`).

## 4) Repository context
Relevant files:
- `/apps/web/src/pages/WorkPage.tsx`
- `/apps/web/src/i18n/resources.ts`
- `/apps/web/src/styles.css`

New file:
- `/apps/web/src/pins/pins.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- Manual smoke:
  1. Open `http://localhost:5173/work`
  2. Select a room and create a thread + message
  3. Pin the thread and the message
  4. Refresh the page: pins persist
  5. Click a pinned item: the thread opens

## 6) Step-by-step plan
1. Add `pins.ts` helpers (load/save/toggle) with a stable schema.
2. Add a Pins section to Work page (room-scoped view).
3. Add pin/unpin controls for thread rows and message rows.
4. Add i18n strings (en/ko) and minimal CSS for layout.
5. Run typecheck.

## 7) Risks & mitigations
- Risk: localStorage corruption breaks UI.
  - Mitigation: defensive JSON parsing + fallback to empty list.

## 8) Rollback plan
Revert this PR (web-only).

