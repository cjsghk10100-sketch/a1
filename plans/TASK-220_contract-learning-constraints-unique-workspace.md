# TASK-220: Contract Learning Constraints Workspace Isolation (Re-runnable)

## 1) Problem
`apps/api/test/contract_learning_constraints.ts` uses a fixed workspace id (`ws_contract_learning`).
When the suite runs multiple times against the same local `DATABASE_URL`, workspace-scoped counters
(`sec_constraints`, `sec_mistake_counters`) accumulate and assertions like `seen_count === 2` fail.

## 2) Scope
In scope:
- Make `contract_learning_constraints` use a per-run workspace id.
- Replace hard-coded workspace id references in DB assertions with the generated id.
- Verify targeted contract + full API contract chain pass without DB reset.

Out of scope:
- Broad refactor of all contract tests
- API runtime behavior changes
- DB schema/migration changes

## 3) Constraints (Security/Policy/Cost)
- Keep test intent unchanged (still validate learning/constraint/quarantine semantics).
- Avoid introducing global cleanup/deletion logic in tests.
- Keep change minimal and deterministic.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_learning_constraints.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-220_contract-learning-constraints-unique-workspace.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_learning_constraints.ts` passes repeatedly without DB reset.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes without requiring manual DB reset first.

## 6) Step-by-step plan
1. Generate a unique `workspaceId` inside the contract (e.g., timestamp + random suffix).
2. Use that value for request header and all workspace-scoped SQL assertions.
3. Run targeted contract twice to confirm re-runnable behavior.
4. Run full API contract chain once and confirm success.

## 7) Risks & mitigations
- Risk: introducing non-ASCII or invalid workspace id chars.
  - Mitigation: use ASCII-safe lowercase alnum + underscore only.
- Risk: missing one hard-coded reference and still leaking state.
  - Mitigation: grep for remaining `ws_contract_learning` in the file after edit.

## 8) Rollback plan
Revert the test file and this plan file in one commit.
