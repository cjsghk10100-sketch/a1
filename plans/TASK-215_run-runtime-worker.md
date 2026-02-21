# TASK-215: Run Runtime Worker (Queued -> Executed)

## 1) Problem
Runs can be created and controlled manually, but queued runs are not executed automatically.
For local operation, we need a minimal runtime worker that consumes queued runs and produces
observable run/step/tool lifecycle without curl/manual button choreography.

## 2) Scope
In scope:
- Add API runtime module that processes queued runs in a safe batch loop.
- Worker execution path per run:
  - `run.started`
  - `step.created` (runtime step)
  - `tool.invoked` + `tool.succeeded` (noop runtime tool)
  - `run.completed`
- Add CLI script for one-shot / polling worker operation.
- Add contract test for worker cycle behavior.

Out of scope:
- LLM/model orchestration engine
- External tool execution
- Scheduler/queue infrastructure beyond simple polling script
- API/DB schema changes

## 3) Constraints (Security/Policy/Cost)
- Keep append-only event model (no direct state mutation shortcuts).
- Preserve existing projector paths (`applyRunEvent`, `applyToolEvent`).
- Use conservative queue claim (`FOR UPDATE SKIP LOCKED`) to avoid duplicate processing across workers.
- Keep cheap-by-default: single-process local worker with bounded batch size.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/runs.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/runProjector.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/toolProjector.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/scripts/lifecycle_automation.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/runtime/runWorker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/scripts/run_worker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_worker.ts`

Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/package.json`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Worker contract verifies:
  - queued run is consumed once,
  - run reaches `succeeded`,
  - one runtime step and one runtime tool call are projected,
  - second worker cycle is no-op for already-ended run.

## 6) Step-by-step plan
1. Implement `runQueuedRunsWorker` runtime module with:
   - queue claim (row lock),
   - run execution event chain,
   - per-cycle counters.
2. Add `scripts/run_worker.ts` with env-driven once/poll mode.
3. Add `contract_run_worker.ts` integration contract.
4. Wire new test into API test chain and add script entry.
5. Run typecheck + full contract suite.

## 7) Risks & mitigations
- Risk: duplicate run processing with concurrent workers.
  - Mitigation: `FOR UPDATE SKIP LOCKED` queue claim + status recheck.
- Risk: partial execution leaves run in running state.
  - Mitigation: on execution error after start, append `run.failed` best-effort.

## 8) Rollback plan
Revert runtime worker module, script, test, and package script wiring in a single revert commit.
