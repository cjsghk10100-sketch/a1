# TASK-308: Desktop Port Preflight Guard (API/Web)

## 1) Problem
Desktop startup currently fails late when API/Web ports are already occupied, often surfacing as generic startup timeout.  
Operators need immediate and actionable feedback for port conflicts.

## 2) Scope
In scope:
- Add preflight port availability checks for `DESKTOP_API_PORT` and `DESKTOP_WEB_PORT`.
- Fail fast before spawning runtime children when either port is in use.
- Improve failure window guidance with env override examples.
- Update README with conflict troubleshooting command examples.

Out of scope:
- Automatic process takeover.
- Port auto-selection/random fallback.
- API/web contract changes.

## 3) Constraints (Security/Policy/Cost)
- Keep runtime local-only behavior.
- No new dependencies.
- No secrets/logging policy changes.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/README.md`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. Manual:
   - Occupy API or web port, then run desktop.
   - Desktop should fail fast with clear `port_in_use` guidance.

## 6) Step-by-step plan
1. Add `node:net` preflight helper in desktop launcher.
2. Check API and web ports before spawning child processes.
3. Throw descriptive errors on port conflicts.
4. Extend failure window + README with override examples.
5. Run validation commands.

## 7) Risks & mitigations
- Risk: false-positive check due to race.
  - Mitigation: keep spawn-time logs and current timeout fallback in place.
- Risk: guidance mismatch.
  - Mitigation: include exact env var names used by launcher.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/README.md`
