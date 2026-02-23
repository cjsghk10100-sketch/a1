# TASK-304: External Engine Runner (Claim Loop)

## Goal
Provide a standalone external-engine process that can claim queued runs from API and execute the run lifecycle without embedded worker mode.

## Scope
- Add `apps/engine` package.
- Implement claim loop:
  - `POST /v1/runs/claim`
  - `POST /v1/runs/:runId/steps`
  - `POST /v1/steps/:stepId/toolcalls`
  - `POST /v1/toolcalls/:toolCallId/succeed|fail`
  - `POST /v1/steps/:stepId/artifacts`
  - `POST /v1/runs/:runId/complete|fail`
- Add env-based runtime controls for API URL/workspace/poll interval.
- Document local run instructions in README.

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. Manual:
   - Start API without embedded worker.
   - Run `pnpm -C apps/engine dev`.
   - Create queued run; verify engine claims and finishes run.
