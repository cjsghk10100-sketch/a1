# TASK-303: Desktop Runtime Hardening (Process Lifecycle)

## Goal
Stabilize Electron runtime lifecycle so local desktop operation does not leave orphan API/Web processes.

## Scope
- Enforce single desktop instance lock.
- Add deterministic shutdown path (`before-quit` -> runtime cleanup -> app exit).
- Add signal handlers (`SIGINT`, `SIGTERM`) to trigger cleanup.
- Add desktop package typecheck script for launcher syntax validation.

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. `pnpm -C apps/desktop typecheck`
