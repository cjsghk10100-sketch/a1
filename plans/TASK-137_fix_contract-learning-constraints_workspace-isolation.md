# TASK-137: Fix Contract Test Isolation (Learning Constraints)

## 1) Problem
`apps/api/test/contract_learning_constraints.ts` assumes a clean workspace when asserting
`sec_constraints.seen_count === 2` after two policy evaluations. When the full contract suite
runs sequentially against the same `DATABASE_URL`, earlier tests can also record learning
signals in the same workspace, causing the counter to accumulate (e.g. `4 !== 2`) and the
suite to fail.

## 2) Scope
In scope:
- Make the learning-constraints contract test use a workspace id unique to that test so it
  cannot be affected by prior tests in the suite.

Out of scope:
- Changing production behavior.
- Reworking the contract test harness across all tests.

## 3) Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

