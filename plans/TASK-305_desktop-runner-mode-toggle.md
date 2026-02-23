# TASK-305: Desktop Runner Mode Toggle (embedded | external)

## 1) Problem
Desktop MVP currently always starts API with embedded worker mode.  
Now that `apps/engine` exists, desktop runtime should support both modes so local operators can run the external engine path without manual extra terminals.

## 2) Scope
In scope:
- Add desktop runtime mode env toggle.
- In `external` mode: start API with `RUN_WORKER_EMBEDDED=0` and auto-start `apps/engine`.
- Keep `embedded` as default for backward compatibility.
- Ensure shutdown kills all spawned child processes.
- Document mode and env variables in README.

Out of scope:
- Desktop packaging/distribution.
- API schema/event changes.
- Engine business logic changes.

## 3) Constraints (Security/Policy/Cost)
- No bypass of API policy gates.
- No secret logging.
- Keep current local-only runtime assumptions.

## 4) Repository context
Existing relevant files:
- `apps/desktop/src/main.cjs`
- `README.md`

New files:
- none

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. Manual smoke:
   - `pnpm desktop:dev` (default embedded mode) boots as before.
   - `DESKTOP_RUNNER_MODE=external pnpm desktop:dev` boots API+web+engine orchestration.

## 6) Step-by-step plan
1. Add mode parser in desktop runtime with default `embedded`.
2. Add optional `engineProcess` lifecycle to process manager.
3. Update API env wiring based on mode.
4. Spawn engine process only in external mode.
5. Update shutdown logic to terminate engine too.
6. Update README docs with mode/env examples.
7. Run validation commands.

## 7) Risks & mitigations
- Risk: external mode starts both embedded worker and external engine accidentally.
  - Mitigation: force `RUN_WORKER_EMBEDDED=0` when mode is external.
- Risk: child process leak.
  - Mitigation: include `engineProcess` in shared shutdown path.

## 8) Rollback plan
Revert `apps/desktop/src/main.cjs` and `README.md` changes to restore fixed embedded-only startup.
