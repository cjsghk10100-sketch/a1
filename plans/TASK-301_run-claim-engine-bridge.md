# TASK-301: Run Claim API (External Engine Bridge Skeleton)

## 1) Problem
The OS skeleton has local queued-run execution (`runs:worker`), but there is no stable API contract for an external execution engine to safely claim queued runs without direct DB access. This blocks clean decoupling between Agent OS and a separate engine process.

## 2) Scope
In scope:
- Add `POST /v1/runs/claim` to claim one queued run atomically (workspace + optional room scope).
- Add run lock hardening to `POST /v1/runs/:runId/start` using the same advisory lock namespace used by runtime worker.
- Add API contract test for run claiming behavior.
- Update docs for the external-engine run claim flow.

Out of scope:
- Trading strategy/order execution logic.
- New run lifecycle states.
- Worker heartbeat/lease expiration.
- Web UI changes.

## 3) Constraints (Security/Policy/Cost)
- Request != Execute boundaries:
  - This task only claims/starts runs in OS. It does not bypass policy/approval/egress paths.
- Redaction rules:
  - No secrets added. Existing event append path still enforces DLP/redaction behavior.
- Budget caps:
  - No new paid dependencies.

## 4) Repository context
- Existing relevant files (paths):
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/runs.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/runtime/runWorker.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/package.json`
  - `/Users/min/Downloads/에이전트 앱/docs/SPEC_v1_1.md`
  - `/Users/min/Downloads/에이전트 앱/README.md`
- New files to add (paths):
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_claim.ts`

## 5) Acceptance criteria (observable)
- Commands to run:
  - `pnpm -r typecheck`
  - `pnpm -C apps/web test`
  - `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Expected outputs:
  - TypeScript checks pass for all workspace packages.
  - Existing web tests pass.
  - API contract suite passes including new run-claim contract.

## 6) Step-by-step plan
1. Add lock helpers and `POST /v1/runs/claim` route in runs API.
2. Harden `POST /v1/runs/:runId/start` with the same advisory lock to avoid start races.
3. Add `contract_run_claim.ts` covering claim order, room/workspace scoping, and run.started actor.
4. Wire new contract test into API test script.
5. Update README/SPEC endpoint docs for external-engine claim flow.
6. Run typecheck/tests and fix any regressions.

## 7) Risks & mitigations
- Risk: lock contention causing transient `run_locked` responses.
- Mitigation: return explicit conflict error so callers can retry safely.
- Risk: divergence between worker and route lock namespace.
- Mitigation: keep namespace constant value aligned and documented in code comments.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/runs.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_claim.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/package.json`
- `/Users/min/Downloads/에이전트 앱/docs/SPEC_v1_1.md`
- `/Users/min/Downloads/에이전트 앱/README.md`
Then rerun typecheck + tests to confirm baseline restored.
