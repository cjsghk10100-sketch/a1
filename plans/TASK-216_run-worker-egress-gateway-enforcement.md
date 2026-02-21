# TASK-216: Run Worker Egress Gateway Enforcement

## 1) Problem
Queued runs are now auto-executed by the runtime worker, but worker execution is still a noop path (`runtime.noop`) and does not exercise the OS egress boundary.
This leaves a gap: runtime execution can complete without proving Request != Execute behavior at run-time.

## 2) Scope
In scope:
- Extract egress request/decision handling into a reusable API service (same behavior as `/v1/egress/requests`).
- Reuse the service from `/v1/egress/requests` route (behavior-preserving refactor).
- Extend runtime worker:
  - if run input contains `runtime.egress.target_url`, worker executes an `egress.request` tool path,
  - worker records egress request events/rows via gateway service,
  - worker fails run when egress is blocked by policy (`blocked=true`),
  - worker succeeds run when not blocked.
- Add contract test covering worker + egress gateway integration.

Out of scope:
- DB schema changes
- New policy types or approval schema changes
- Full external HTTP execution (this task records decision path only)
- Web UI changes

## 3) Constraints (Security/Policy/Cost)
- Keep append-only event flow.
- Keep route semantics for `/v1/egress/requests` unchanged.
- Enforce Request != Execute at runtime worker boundary using policy `blocked` signal.
- Keep cheap-by-default: egress path is opt-in via run input; default worker behavior remains noop.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/egress.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/runtime/runWorker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_worker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/egress/requestEgress.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_worker_egress.ts`

Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/egress.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/runtime/runWorker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/package.json`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_run_worker_egress.ts` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract assertions:
  - runtime worker with `runtime.egress` input writes `sec_egress_requests` row and `egress.requested` + outcome event,
  - allow path ends run as `succeeded`,
  - blocked path (enforced external.write without approval) ends run as `failed`.

## 6) Step-by-step plan
1. Extract `/v1/egress/requests` core logic into `requestEgress(...)` service.
2. Refactor route to call service and map service output to current API response shape.
3. Extend runtime worker to parse optional `runtime.egress` input and run `egress.request` tool lifecycle.
4. Add new contract test for allow + blocked worker egress scenarios.
5. Wire test into API test script and run typecheck + API tests.

## 7) Risks & mitigations
- Risk: Route behavior drift after refactor.
  - Mitigation: keep route response mapping unchanged and retain existing contract_egress coverage.
- Risk: Worker run completion semantics become inconsistent under shadow mode.
  - Mitigation: use `blocked` as execution gate (not raw decision), preserving shadow/enforce intent.
- Risk: Parsing flexible run input causes runtime errors.
  - Mitigation: defensive object/string normalization; fallback to noop behavior.

## 8) Rollback plan
Revert service extraction + worker egress path + new contract test in one revert commit.
No migration rollback required.
