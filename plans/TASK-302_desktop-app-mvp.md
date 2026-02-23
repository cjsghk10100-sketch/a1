# TASK-302: Desktop App MVP (Electron Auto-Start, External Postgres)

## Goal
Run Agent OS in a desktop window for local operations without manually launching each process.

## Scope
- Add `apps/desktop` Electron launcher package.
- Auto-start `apps/api` with `RUN_WORKER_EMBEDDED=1`.
- Auto-start `apps/web` Vite dev server.
- Load `/desktop-bootstrap` on desktop startup.
- Show in-app diagnostics + recovery commands when API/DB health fails.
- Ensure child process cleanup on app exit.

## Out of Scope
- DMG/installer packaging.
- Database engine replacement.
- Backend API contract changes.

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. Manual:
   - `pnpm desktop:dev` opens Electron.
   - Healthy DB: redirects `/desktop-bootstrap` -> `/timeline`.
   - DB down: shows diagnostics and retry flow.
   - App close: API/Web child processes are terminated.
