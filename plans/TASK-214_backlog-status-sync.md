# TASK-214: Backlog Status Sync (source-of-truth alignment)

## 1) Problem
`BACKLOG.md` still shows early MVP tasks as unchecked, even though many are already implemented in `/plans` and merged.
This causes execution drift and makes next-priority selection ambiguous.

## 2) Scope
In scope:
- Sync `BACKLOG.md` checklist state with merged implementation status.
- Keep remaining work visible (especially MVP-6 and optional MVP-3).
- Add a short note that detailed execution history continues in `/plans`.

Out of scope:
- Any API/DB/Web behavior changes.
- Reordering or redefining the technical scope of already implemented tasks.

## 3) Constraints (Security/Policy/Cost)
- Docs-only change.
- No dependency or runtime impact.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/BACKLOG.md`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-214_backlog-status-sync.md`

## 5) Acceptance criteria (observable)
- `BACKLOG.md` reflects:
  - Completed: TASK-001/002/003, 010/011/012, 020/021/022, 040/041/042, 050/051/052.
  - Remaining: TASK-060/061/062, TASK-030/031/032.
- `git diff` only includes backlog sync + plan file.

## 6) Step-by-step plan
1. Create TASK-214 plan.
2. Update checklist states in `BACKLOG.md`.
3. Add note that extended completed work exists under `/plans` (TASK-099+).
4. Commit and push.

## 7) Risks & mitigations
- Risk: marking an item complete that was only partially implemented.
- Mitigation: only mark items that have concrete task plans and merged commits in repo history.

## 8) Rollback plan
Revert `BACKLOG.md` and remove TASK-214 plan file.
