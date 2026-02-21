# TASK-225: Contract Secrets Re-run Isolation (Unique Workspace/Secret Name)

## 1) Problem
`contract_secrets.ts` reuses a fixed workspace (`ws_contract`) and secret name (`github_token`).
On reruns against the same DB, secret creation can return update semantics (`200`) and list counts can drift.

## 2) Scope
In scope:
- Use a per-run workspace id for the contract.
- Use a per-run secret name and adjust related assertions.
- Preserve existing vault/access/redaction behavior checks.

Out of scope:
- API behavior changes
- Migration/schema changes

## 3) Constraints (Security/Policy/Cost)
- Keep secret value leakage checks unchanged.
- Keep test-only changes minimal.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_secrets.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-225_contract-secrets-unique-workspace-and-secret-name.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Full API contract run no longer fails at secrets create assertion (`200 !== 201`).

## 6) Step-by-step plan
1. Add per-run suffix and derive unique workspace id + secret name.
2. Replace hard-coded secret name assertions with variable-based checks.
3. Run typecheck + full API contracts.

## 7) Risks & mitigations
- Risk: missing one hard-coded `github_token` assertion.
  - Mitigation: grep file for remaining literal references and replace where needed.

## 8) Rollback plan
Revert this plan and test file in one commit.
