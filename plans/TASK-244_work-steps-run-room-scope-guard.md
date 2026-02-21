# TASK-244: Work Steps Run Selection Room-Scope Guard

## 1) Problem
`selectStepsRunForRoom` currently writes local steps-run selection only when the target room is the currently visible room. During async completion flows (create/start/complete/fail), room switches can drop room-scoped selection updates, causing inconsistent restoration when returning to that room.

## 2) Scope
In scope:
- Update room-scoped run selection helper to always persist by target room.
- Keep in-memory `stepsRunId` updates guarded to current room only.
- Ensure no cross-room state overwrite occurs.

Out of scope:
- API/DB changes
- New UI controls
- Step/tool/artifact flow changes

## 3) Constraints (Security/Policy/Cost)
- Web-only state consistency fix.
- No behavior changes for policy/approval paths.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-244_work-steps-run-room-scope-guard.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Async run actions no longer risk current-room state overwrite; run selection is persisted per target room.

## 6) Step-by-step plan
1. Change `selectStepsRunForRoom` to always call `saveStepsRunId(room, run)`.
2. Keep `setStepsRunId(run)` behind current-room guard (`roomIdRef.current === room`).
3. Run verification commands.

## 7) Risks & mitigations
- Risk: Persisting stale run IDs for non-current rooms.
  - Mitigation: existing runs reconciliation effect revalidates selected run against loaded room runs.

## 8) Rollback plan
Revert the helper change in `WorkPage.tsx`.
