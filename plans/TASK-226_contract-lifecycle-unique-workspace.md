# TASK-226: Contract Lifecycle Re-run Isolation (Unique Workspace)

## 1) Problem
`contract_lifecycle.ts` uses a fixed workspace id (`ws_contract_lifecycle`).
On reruns against a reused DB, lifecycle automation sees old rows and `evaluated_targets` exceeds expected counts.

## 2) Scope
In scope:
- Generate a per-run workspace id inside `contract_lifecycle`.
- Replace all hard-coded workspace references in headers, inserts, automation calls, and assertions.

Out of scope:
- Lifecycle automation implementation changes
- Schema/migration changes

## 3) Constraints (Security/Policy/Cost)
- Keep lifecycle transition expectations intact.
- Keep changes strictly test-scoped.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_lifecycle.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-226_contract-lifecycle-unique-workspace.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Full API contract chain no longer fails with `evaluated_targets` drift in lifecycle contract.

## 6) Step-by-step plan
1. Add per-run suffix and workspace id variable.
2. Route all lifecycle contract workspace usages through that variable.
3. Run typecheck + full API contracts.

## 7) Risks & mitigations
- Risk: missed hard-coded workspace string.
  - Mitigation: grep for `ws_contract_lifecycle` after edit.

## 8) Rollback plan
Revert this plan and contract file in one commit.
