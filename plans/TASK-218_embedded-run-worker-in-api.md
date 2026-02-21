# TASK-218: Embedded Run Worker in API Process (Opt-in)

## 1) Problem
Queued runs are now executable via worker logic, but local operators must run a separate worker process.
This adds friction for single-node local operation and makes “just run API + web” less self-contained.

## 2) Scope
In scope:
- Add optional embedded worker loop to API server process (opt-in via env/config).
- Add config flags:
  - `RUN_WORKER_EMBEDDED` (default false)
  - `RUN_WORKER_POLL_MS` (default 1000)
  - `RUN_WORKER_BATCH_LIMIT` (optional)
  - `RUN_WORKER_WORKSPACE_ID` (optional)
- Start worker loop when server is ready; stop loop gracefully on server close.
- Add contract test proving queued run is auto-processed when embedded mode is enabled.

Out of scope:
- Multi-node scheduler/leader election
- Advanced backoff or distributed queue infra
- Web UI changes

## 3) Constraints (Security/Policy/Cost)
- Keep feature opt-in to avoid behavior changes in existing environments.
- Reuse existing `runQueuedRunsWorker` path (no duplicate execution logic).
- Prevent overlapping cycles in a single process (in-flight guard).
- Preserve clean shutdown ordering (stop loop before closing DB pool).

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/config.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/server.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/runtime/runWorker.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_worker.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_run_worker_embedded.ts`

Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/config.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/server.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/package.json`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_run_worker_embedded.ts` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes on clean DB.
- Embedded mode contract verifies a queued run transitions to `succeeded` without calling worker API/script directly.

## 6) Step-by-step plan
1. Extend config parsing with embedded worker options.
2. Add embedded loop lifecycle in server build/close hooks.
3. Add contract test for embedded mode auto-processing.
4. Wire test into API test chain.
5. Run typecheck + targeted + full suite.

## 7) Risks & mitigations
- Risk: worker loop runs concurrently with shutdown and touches closed pool.
  - Mitigation: stop flag + timer clear before `pool.end()`.
- Risk: duplicate processing in same process from overlapping ticks.
  - Mitigation: in-flight guard around loop cycle.
- Risk: behavior regression for existing setups.
  - Mitigation: default `RUN_WORKER_EMBEDDED=false`.

## 8) Rollback plan
Revert config/server/test changes for embedded worker in one commit.
No migration rollback required.
