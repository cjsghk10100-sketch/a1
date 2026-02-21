# TASK-227: Contract Re-run Safety Guard in CI

## 1) Problem
Recent failures came from contract tests using fixed ids/workspace values.  
Even after fixing tests, CI currently validates only a single full contract pass and can miss future re-run regressions.

## 2) Scope
In scope:
- Add a focused API test script for re-run safety against reused DB state.
- Run that focused script in CI after the full contract suite, twice sequentially.
- Keep changes minimal and test/CI-only.

Out of scope:
- API runtime behavior changes
- DB schema/migration changes
- Expanding full CI matrix

## 3) Constraints (Security/Policy/Cost)
- No security-policy behavior change.
- Keep CI runtime increase controlled by using a small targeted subset.
- Preserve existing full contract test job.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/package.json`
- `/Users/min/Downloads/에이전트 앱/.github/workflows/ci.yml`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-227_contract-rerun-safety-ci.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api run test:rerun-safety` passes repeatedly.
- CI has a new step that runs re-run safety checks twice on the same DB after full contracts.

## 6) Step-by-step plan
1. Add `test:rerun-safety` script in `apps/api/package.json` with the known re-run-sensitive contracts.
2. Add CI step to run that script twice sequentially after the existing full contract run.
3. Run local typecheck + rerun-safety script twice to validate.

## 7) Risks & mitigations
- Risk: CI time increase.
  - Mitigation: keep subset focused and small.
- Risk: subset misses another future fixed-id regression.
  - Mitigation: expand subset later when new regressions appear.

## 8) Rollback plan
Revert the CI and package.json changes plus this plan file in one commit.
