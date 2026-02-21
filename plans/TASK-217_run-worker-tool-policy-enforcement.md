# TASK-217: Run Worker Tool Policy Enforcement

## 1) Problem
Runtime worker now executes queued runs and routes egress decisions through gateway, but its tool invocation path still bypasses the tool policy gate.
This creates a parity gap with `/v1/steps/:stepId/toolcalls`, where tool execution is policy-gated before execution.

## 2) Scope
In scope:
- Add worker-side tool policy enforcement via `authorize_tool_call` for runtime tools (`runtime.noop`, `egress.request`).
- Support optional runtime policy context from run input:
  - `runtime.policy.principal_id`
  - `runtime.policy.capability_token_id`
  - `runtime.policy.zone`
- When policy returns `blocked=true`, mark tool call as failed and fail run.
- Pass policy context through worker egress requests so capability/zone scopes are consistently enforced.
- Add contract test proving worker run fails when capability token blocks runtime tool.

Out of scope:
- New DB schema/migrations
- Policy rule authoring UI or new policy DSL
- Full runtime engine changes beyond worker policy boundary

## 3) Constraints (Security/Policy/Cost)
- Preserve append-only event model.
- Keep worker deterministic and cheap-by-default.
- Follow existing policy semantics: use `blocked` as execution cutoff (shadow mode remains non-blocking).
- Keep route behavior unchanged.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/runtime/runWorker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_worker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_toolcalls.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_worker_tool_policy.ts`

Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/runtime/runWorker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/package.json`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_run_worker_tool_policy.ts` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes on clean test DB.
- Contract assertions:
  - worker run with restricted capability token is denied at tool policy stage,
  - tool call is projected as failed,
  - run is projected as failed,
  - `policy.denied` is emitted for that run/step.

## 6) Step-by-step plan
1. Parse optional runtime policy context from run input in worker.
2. Call `authorize_tool_call` before runtime tool execution.
3. Apply blocked policy result to worker tool/run lifecycle.
4. Add contract test for capability-based tool denial in worker path.
5. Wire test in API test chain and run typecheck + contracts.

## 7) Risks & mitigations
- Risk: worker behavior diverges from route toolcall behavior.
  - Mitigation: enforce same authorize function and blocked semantics.
- Risk: optional policy context parsing causes runtime errors.
  - Mitigation: defensive parsing with optional defaults.
- Risk: full suite flakiness due reused local DB.
  - Mitigation: run full suite on clean test DB before finalizing.

## 8) Rollback plan
Revert worker policy additions and the new contract test in one revert commit.
No migration rollback required.
